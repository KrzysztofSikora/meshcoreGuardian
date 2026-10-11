# Propozycje usprawnień orchestratora SDD (do zatwierdzenia)

**Projekt:** MeshCore Guardian · **Data:** 2026-10-11

**Zakres:** analiza kodu (`.claude/workflow/*`, `.claude/skills/*`, `package.json`, `CLAUDE.md`), logów 38 sesji (F-01, S-01, S-02) i wyników dwóch wcześniejszych audytów. Niczego nie zmieniano, nie commitowano i nie uruchamiano.

**Oznaczenia:**
- **[F]** fakt z kodu albo logów;
- **[H]** hipoteza lub szacunek, niegwarantowany.

---

## 0. Ocena stanu obecnego

**Co działa dobrze [F]:**
- **Żadnych patologicznych pętli.** Stop hook zawrócił sesję tylko raz w 38 sesjach (F-01), w implementacji S-01 i S-02 ani razu. W żadnej fazie nie było więcej niż jednego nieudanego testu pod rząd.
- **Routing modeli działa.** S-02 (rozmiar L) kosztował 5,46 mln tokenów w implementacji. S-01 (M, na Opusie) kosztował 14,77 mln, ale pozycje nie są wprost porównywalne.
- **Niezależne review działa.** Review na Opusie, jako fork, znalazło realne problemy: S-02 runda 1 dała CHANGES REQUESTED z 4 uwagami. Mutation testing wzmocnił asercje (commity `test(...)` w S-01 i S-02).
- **Wznawianie od artefaktów zadziałało** po limicie w S-01.

**Gdzie są straty [F]:**
1. **Niezawodność końcówki runu.** S-01 i S-02 skończyły się bez poprawnie opublikowanego PR-a:
   - S-01: push odrzucony, `Permission denied (publickey)`, po wykonaniu całej pracy;
   - S-02: `pull request title must not be blank`.
2. **Limit użycia nie jest obsługiwany.** S-01 `09-review`: $1.13 pracy Opusa utracone, potem 3 sesje z `usage_limit_reached` i draft „wip”.
3. **Te same bramki są uruchamiane wielokrotnie przez agentów.** Np. S-02: e2e w implement F5 ×6, review ×1, fix-review ×1, review 2 ×1.
4. **Każda sesja zaczyna od zera.** Start fazy zajmuje 5–11 tur do pierwszego zapisu kodu. `plan.md` (40–48 KB) jest czytany wielokrotnie.

---

## 1. Propozycje

### P1. Niezawodna publikacja PR-a (preflight, REST, zapasowy tytuł)

> **✅ Wdrożono 2026-10-11.** Zakres wdrożenia:
> - preflight `check_remote_access` (`lib.sh`), wywoływany w `ship` (gdy PR ma być otwarty) i w `address-pr`: odczyt `origin` (`git ls-remote`), push na sucho, `gh auth status`; brak dostępu zatrzymuje run przed pierwszą sesją;
> - `publish_pr` (`lib.sh`) tworzy i aktualizuje PR przez REST (`gh api …/pulls`, POST i PATCH) zamiast `gh pr create` / `gh pr edit`; `address-pr` odpowiada komentarzem przez REST zamiast `gh pr comment`;
> - `wf.py pr-title` / nowe `wf.py pr-body`: tytuł z pierwszej linii `# `, inaczej z pierwszej niepustej linii zwykłego tekstu, inaczej `wip(<change-id>): <ID>`; linia tytułu jest usuwana z treści;
> - nieudany push zapisuje w `run-summary.md` polecenie `ship <ID> --publish-only`; nowa flaga `--publish-only` publikuje z istniejącego `pr-body.md` bez żadnej sesji.
>
> Sprawdzone testami w tymczasowym repo (lokalny origin + podstawiony `gh`): tytuły (6 przypadków, w tym S-02), nowy PR, aktualizacja istniejącego PR-a, draft, nieudany push, brak dostępu do origin, brak logowania `gh`, `--publish-only`. Preflight sprawdzony też na prawdziwym GitHubie (bez utworzenia gałęzi). Nie sprawdzono: odmowy zapisu przy push na sucho na lokalnym originie (lokalny transport nie weryfikuje uprawnień).

- **Problem:** publikacja PR-a jest ostatnim krokiem runu i jedynym, którego nikt wcześniej nie sprawdza. Jej awaria marnuje cały run, bo wymaga ręcznej interwencji.
- **Dowód [F]:**
  - **S-01:** `git push` w `publish_pr` (`lib.sh:180`) padł z `Permission denied (publickey)` dopiero po review i opisie PR-a.
  - **S-02:** `wf.py pr-title` szuka linii zaczynającej się od `# `, a `pr-body.md` zaczynał się bez `#`. Skutek: `gh pr create` dostał pusty tytuł i run zakończył się kodem 1.
  - **Ścieżka aktualizacji PR-a** (`lib.sh:182`) używa `gh pr edit`. W tym repo `gh pr edit` kończy się błędem GraphQL `Projects (classic) is being deprecated … (repository.pullRequest.projectCards)` (zaobserwowane przy PR #13). Ta ścieżka się wykona przy każdym wznowieniu runu z istniejącym PR-em.
- **Rozwiązanie:**
  1. **Preflight w `ship` i `address-pr`, przed pierwszą sesją:**
     - `git ls-remote --exit-code origin HEAD` (dostęp do zdalnego repo);
     - `gh auth status`;
     - opcjonalnie `git push --dry-run`.

     Brak dostępu zatrzymuje run od razu (`die`), zanim zużyje limit.
  2. **`publish_pr`:** tworzenie i edycja PR-a przez REST (`gh api repos/{owner}/{repo}/pulls`, PATCH), nie przez `gh pr edit`.
  3. **`wf.py pr-title`:** jeśli nie ma linii `# `, tytułem jest pierwsza niepusta linia, a w ostateczności `<typ>(<change-id>): <roadmap ID>`. `publish_pr` zdejmuje tę linię z treści.
  4. **Gdy push mimo to padnie:** zapis do `run-summary.md` z gotowym poleceniem do ręcznego wznowienia publikacji (`ship <ID> --publish-only`).
- **Pliki:** `.claude/workflow/ship` (preflight), `address-pr` (preflight), `lib.sh` → `publish_pr`, `wf.py` → `pr-title`.
- **Korzyści:** niezawodność [F: 2 z 3 ostatnich runów wymagały ręcznej publikacji]. Tokeny i tury bez zmian. Czas: koniec ręcznych interwencji [H].
- **Ryzyko:** praktycznie brak wpływu na jakość kodu i review.
- **Priorytet:** **teraz.**

### P2. Obsługa limitu użycia: czekanie i ta sama próba

- **Problem:** limit sesji jest traktowany jak niekompletny artefakt.
- **Dowód [F]:**
  - `run_step` (`lib.sh`) robi ponowną próbę, gdy `wf.py check` nie przejdzie;
  - log `protocol-feasibility-gate/10-review.jsonl` ma `"api_error_status":429,"api_error":"usage_limit_reached","result":"You've hit your session limit · resets 4:40pm"`;
  - kolejne sesje `10`–`12` kosztowały $0, a run otworzył draft „wip” przez `write_pr_body` z planem awaryjnym.
- **Rozwiązanie:**
  - **`wf.py`:** nowa komenda `limit <log>`. Zwraca godzinę resetu, jeśli zdarzenie `result` ma `api_error: usage_limit_reached` (z uwzględnieniem strefy czasowej i ewentualnej doby).
  - **`run_step`:**
    1. Po każdej sesji sprawdza limit.
    2. Jeśli limit wystąpił, czeka do resetu plus 3 min (przerywalnie), zapisuje to w `run-summary.md` i **powtarza tę samą próbę** bez zwiększania licznika prób.
    3. Maksymalnie N oczekiwań, np. 3. Potem kończy run normalnie, bez otwierania draftu „wip”.
  - **`write_pr_body`:** nie uruchamia `pr-body`, gdy run zatrzymał się na limicie.
- **Pliki:** `lib.sh` → `run_step`, `write_pr_body`; `wf.py` → nowa komenda; `config.sh` → `WORKFLOW_LIMIT_WAITS`.
- **Korzyści:**
  - niezawodność: run dochodzi do PR-a bez człowieka [H];
  - tokeny: nie da się odzyskać sesji przerwanej w trakcie (w S-01 $1.13), ale znikają puste próby i draft [F];
  - czas: run kończy się sam po resecie.
- **Ryzyko:** niskie dla jakości. Wymaga, żeby laptop nie usypiał. Przerwana sesja zostawia częściowe zmiany, a obecne `save_leftovers` i czyste drzewo w `implement` to już obsługują [F].
- **Priorytet:** **teraz.**

### P3. Bramki uruchamiane przez runner, z cache wyników na commit (nowe)

- **Problem:** bramki są deterministyczne, a uruchamiają je agenci, wielokrotnie, na tym samym kodzie. Każde uruchomienie kosztuje tury, tokeny wyjścia i czas (e2e buduje APK). Agent w dodatku sam relacjonuje wynik.
- **Dowód [F]:**
  - S-02: implement F5 uruchomił e2e 6×;
  - po nim review ×1, fix-review ×1 i review runda 2 ×1, zawsze z pełną listą `typecheck`/`lint`/`test`;
  - F-01 fix-review uruchomił e2e 6×;
  - `review/SKILL.md` krok 4: „Run the gates from the CLAUDE.md Gates table”; `fix-review/SKILL.md:39`: to samo.
- **Rozwiązanie:**
  - **`lib.sh` → nowa funkcja `run_gates <label>`:** runner (bash, bez modelu) uruchamia bramki z tabeli Gates **po ostatniej fazie implement** i **po każdym `fix-review`**. Wynik zapisuje w `.workflow/gates/<HEAD-sha>.md` (status i ostatnie ~40 linii każdej bramki), w `context/changes/<id>/evidence/gates-<sha>.md` i w `run-summary.md`.
  - **`/review` i `/fix-review`:** czytają ten plik. Bramki uruchamiają same tylko wtedy, gdy plik dla bieżącego `HEAD` nie istnieje albo gdy weryfikują konkretną uwagę. Review zachowuje pełną niezależność oceny kodu, a odpada tylko mechaniczne powtarzanie.
  - **Czerwona bramka po fix-review** blokuje „APPROVE” na poziomie runnera, czyli jest twardą bramką, a nie deklaracją agenta.
  - `/implement` dalej uruchamia szybkie bramki w trakcie fazy (pętla TDD), bez zmian.
- **Pliki:** `lib.sh` (nowa `run_gates`, wywołania w `ship` po `implement_loop` i w `review_loop`), `wf.py check` (review i fix-review zależne od pliku bramek), `.claude/skills/review/SKILL.md`, `fix-review/SKILL.md`.
- **Korzyści:**
  - mniej tur w review i fix-review [H];
  - mniej buildów APK [F: dziś 2–4 dodatkowe e2e na run po implementacji];
  - **niezawodność ↑**, bo wynik bramek jest obiektywny, niezależny od relacji agenta.
- **Ryzyko:** średnio-niskie. Review mogłoby zaufać zielonym bramkom i mniej weryfikować. Łagodzi to zasada „uwagę zawsze potwierdź testem albo skryptem”, która jest już w `review/SKILL.md` krok 3.
- **Priorytet:** **teraz albo w etapie 1b** (wymaga zmiany skilli).

### P4. Krótka „karta fazy” wstrzykiwana przez runner (nowe)

- **Problem:** każda sesja `implement` traci kilka tur na ustalenie, co ma robić: czyta `git status`, `autonomy.md` i `plan.md` w kilku wariantach.
- **Dowód [F]:**
  - pierwsze zapisanie kodu dopiero w turze 5–11 (S-01 F2: 25, z researchem; S-01 F5: 23, z czekaniem na sprzęt);
  - S-01 F5 tury 1–4: ten sam `plan.md` przez `cat`, `grep -n Progress`, `sed -n 1,270p` i `Read`;
  - S-02 F5 tury 2–4: `sed -n 1,295p`, `grep "Phase 5"`, `sed -n 30,130p`;
  - 7 przypadków `<persisted-output>`, w których wynik za duży na wyjście był doczytywany drugi raz przez `Read`.
- **Rozwiązanie:** przed sesją `implement` runner (`wf.py brief <change-id>`) składa krótką kartę: numer i treść bieżącej fazy, listę decyzji D-n, które ta faza dotyka, otwarte `[REVIEW]`, gałąź, stan drzewa, ostatni commit i polecenia bramek. Przekazuje ją przez `--append-system-prompt`. `/implement` czyta resztę planu tylko w razie potrzeby (`Read` z offsetem).
- **Pliki:** `wf.py` (nowa `brief`), `lib.sh` → `implement_loop`/`run_step` (dodatkowy argument), `.claude/skills/implement/SKILL.md` (krok 1: start od karty).
- **Korzyści:** szacunkowo kilka tur mniej na sesję implement i mniejszy kontekst każdej tury [H]. Do sprawdzenia metryką „tury do pierwszego zapisu”.
- **Ryzyko:** średnio-niskie. Implementer może przeoczyć kontekst z innych faz. Łagodzi to podanie w karcie nagłówków całego planu i ścieżek do sekcji.
- **Priorytet:** **etap 1b.**

### P5. Ponowne review tylko po blockerze lub majorze

- **Problem:** kod robi ponowne review także po `APPROVE WITH FOLLOW-UPS`, wbrew własnemu komentarzowi.
- **Dowód [F]:**
  - `lib.sh` → `review_loop`: `[ "$verdict" != "APPROVE" ] && [ "$round" -lt "$rounds" ] || return 0`;
  - komentarz nad funkcją: „a re-review happens only after fixing blockers or majors”;
  - F-01: runda 1 dała `APPROVE WITH FOLLOW-UPS` (4 drobne), fix-review, potem runda 2 na Opusie ($0.56, 2,9 min).
- **Rozwiązanie:** ponowne review tylko wtedy, gdy werdykt był `CHANGES REQUESTED` albo gdy `review.md` miał uwagę `blocker`/`major` (np. `wf.py max-severity`). Po samych drobnych uwagach: fix-review, potem twarde bramki z P3 i koniec.
- **Pliki:** `lib.sh` → `review_loop`; `wf.py` (nowa `max-severity`).
- **Korzyści:** jedna sesja Opusa mniej w runach kończących się drobnymi uwagami [F: zdarzyło się w 1 z 3 runów].
- **Ryzyko:** niskie. Poprawki drobnych uwag robione przez Sonneta nie przechodzą drugiego review, ale przechodzą bramki. Po wdrożeniu P3 bramki są obiektywne.
- **Priorytet:** **teraz.**

### P6. Diff do review bez plików generowanych

- **Problem:** review na Opusie czyta lockfile i nagrania.
- **Dowód [F]:**
  - F-01: `pnpm-lock.yaml` +9 781 linii;
  - S-01: nagrania +15 955 linii;
  - sesje review doczytują zapisany do pliku diff o rozmiarze 44–64 KB (`Read …/tool-results/…`).
- **Rozwiązanie:** w `review/SKILL.md` diff z wykluczeniami (`':(exclude)pnpm-lock.yaml' ':(exclude)**/fixtures/**' ':(exclude)*.png'`) plus `git diff --stat` dla wykluczonych, z zasadą: nagrania sprawdza test, a lockfile zależności z `package.json`. Lista wykluczeń w `CLAUDE.md` albo `config.sh` (`WORKFLOW_REVIEW_EXCLUDES`).
- **Pliki:** `.claude/skills/review/SKILL.md`, ewentualnie `config.sh`.
- **Korzyści:** mniejszy kontekst review, proporcjonalnie do udziału plików generowanych w diffie [H].
- **Ryzyko:** niskie. Zmiana w lockfile bez zmiany w `package.json` mogłaby umknąć, więc reguła powinna to wprost sprawdzać.
- **Priorytet:** **teraz.**

### P7. Plan zwięźlejszy, a research jako osobny, celowany plik

- **Problem:** research z sesji planowania nie jest w formie, z której implementacja może skorzystać, więc implementacja go powtarza. Jednocześnie `plan.md` rośnie.
- **Dowód [F]:**
  - `plan.md`: 40–48 KB;
  - S-01 F2: 13 tur czytania źródeł `meshcore.js` i pobierania firmware z GitHuba (#9–21), choć sesja `plan` analizowała te same źródła;
  - 4–5 tur szukania biblioteki w złym `node_modules` (#3–8).
- **Rozwiązanie:**
  - **`/plan`:** wyniki researchu zapisuje do `research.md`. Każdy wpis ma źródło (ścieżka i zakres linii albo URL z commitem) i 1–3 zdania wniosku, np. „layout DeviceInfo: bajty 4–7 PIN, źródło X”.
  - **Plan zawiera** tylko decyzje, design i fazy, z miękkim limitem około 20 KB.
  - **Karta fazy (P4)** wskazuje wpisy `research.md` dla danej fazy.
- **Pliki:** `.claude/skills/plan/SKILL.md`, `implement/SKILL.md`, `review/SKILL.md` (czytanie sekcji), `pr-body/SKILL.md`.
- **Korzyści:** mniej powtarzanego researchu i mniejszy plan w kontekście każdej sesji [H].
- **Ryzyko:** **średnie.** Zbyt agresywne skracanie planu może pogorszyć implementację i review, które dziś korzystają z pełnego designu. Wymaga porównania A/B.
- **Priorytet:** **etap 2.**

### P8. Metryki tokenów i tur w `run-summary.md`

- **Problem:** nie ma ciągłego pomiaru, więc każdy audyt wymaga ręcznej analizy logów.
- **Dowód [F]:** `wf.py cost` wypisuje tylko `$, turns, subtype`, a `modelUsage` jest w logach, ale nieużywane. Sesje typu fork (`review`, `plan-review`) mają `num_turns: 0` i `usage` z zerami. Ich realne zużycie jest tylko w `modelUsage`.
- **Rozwiązanie:** `wf.py cost` wypisuje tokeny (wejście, zapis cache, odczyt cache, wyjście) na model, tury, czas i błąd API. Na końcu runu tabela kroków w `run-summary.md` i `pr-body` („Run cost”). Opcjonalnie `wf.py report <change-id>` sumujący wszystkie sesje.
- **Pliki:** `wf.py` → `cost`, nowa `report`; `lib.sh` → `write_pr_body`.
- **Korzyści:** warunek oceny wszystkich pozostałych zmian. Bez wpływu na limit.
- **Ryzyko:** brak.
- **Priorytet:** **teraz** (przed innymi zmianami, żeby mieć punkt odniesienia).

### P9. Formatowanie (prettier) jako część bramki lint (nowe)

- **Problem:** formatowanie nie jest w żadnej bramce, więc agenci pilnują go doraźnie.
- **Dowód [F]:**
  - `package.json`: `"lint": "eslint ."`, `"format": "prettier --write ."`, brak `format:check`;
  - S-01 F4 #38–40: `prettier --check` → `--list-different` → `install` + `--write`;
  - S-01 F5 #45–47: poszukiwanie konfiguracji prettiera i hooka (`.husky` nie istnieje).
- **Rozwiązanie:** `"lint": "eslint . && prettier --check ."` (albo osobna bramka `format`) i jedna linia w `CLAUDE.md`: „przed commitem: `pnpm format`”.
- **Pliki:** `package.json`, `CLAUDE.md` (tabela Gates).
- **Korzyści:** kilka tur mniej w fazach, które dotykają wielu plików [H]; mniej niespójności formatowania.
- **Ryzyko:** pierwszy run może pokazać istniejące różnice w formatowaniu. Trzeba je raz wyrównać.
- **Priorytet:** **teraz** (mała zmiana).

### P10. Blokada współbieżnych runów (nowe)

- **Problem:** dwa runy uruchomione w tym samym working tree nadpisałyby sobie stan i gałąź.
- **Dowód [F]:** `wf.py run start` zapisuje `run.json` bez sprawdzenia, czy aktywny run już istnieje. `load_run` rozpoznaje martwy PID, ale nic go nie wywołuje przed startem. `ship` robi `git switch` przed `begin_run`.
- **Rozwiązanie:** w preflight `ship` i `address-pr`: jeśli `load_run()` zwraca żywy run, przerwij z komunikatem. Kontrola przed `git switch`.
- **Pliki:** `ship`, `address-pr` (preflight), `wf.py` (np. `run active`).
- **Korzyści:** niezawodność [H: dziś ryzyko teoretyczne, ale przy ręcznym wznawianiu po limicie realne].
- **Ryzyko:** brak.
- **Priorytet:** **teraz.**

### P11. Model recenzji planu zależny od rozmiaru pozycji

- **Problem:** recenzja planu zawsze idzie na Opusie.
- **Dowód [F]:** `WORKFLOW_MODEL_PLAN_REVIEW=opus`; koszt $0.61–1.07 na run. Recenzje planu znajdowały majory (F-01 #1, S-02 #2).
- **Rozwiązanie:** Opus dla L i dla planów z decyzjami `costly`, Sonnet dla S i M.
- **Pliki:** `config.sh`, `ship`, `wf.py` (rozmiar z roadmapy).
- **Korzyści / ryzyko:** oszczędność umiarkowana [H]. Ryzyko jakościowe **średnie**, bo plan to najdroższe do cofnięcia miejsce.
- **Priorytet:** **później**, tylko jeśli metryki P8 pokażą, że recenzja planu jest istotnym kosztem w stosunku do wartości jej uwag.

### P12. `--effort` dla każdego kroku

- **Fakt:** CLI ma `--effort <level>`. Brak danych o wpływie.
- **Rozwiązanie:** próba A/B: `implement`, `fix-review` i `pr-body` na `medium` przez 1–2 pozycje, porównanie metryk P8 i wyników review.
- **Ryzyko:** nieznane (dlatego najpierw pomiar).
- **Priorytet:** **później.**

### P13. Twardy limit tur na krok (`--max-turns`)

- **Fakt:** najwięcej było 70 tur (F-01 `05-implement`). Pętli nie zaobserwowano.
- **Ocena:** to zabezpieczenie przed patologią, która nie występuje. Może za to przerwać uzasadnioną, długą fazę.
- **Priorytet:** **później albo wcale.** Ewentualnie wysoki próg, np. 150, wyłącznie jako bezpiecznik.

### P14. Odrzucone

- **Równoległe runy w osobnych worktree:** skracają czas, ale zwiększają chwilowe zużycie i przyspieszają dojście do limitu Pro. **Wcale**, przy obecnym planie subskrypcji.
- **Haiku dla `pr-body`:** oszczędność marginalna, bo `pr-body` to ~3% kosztu [F]. Ryzyko błędów w streszczeniu decyzji `costly`. **Wcale.**
- **Mniej faz na siłę (limit M ≤ 3):** dłuższe sesje mają większy kontekst na turę, więc efekt netto jest niepewny [H]. **Później**, tylko po pomiarze.

---

## 2. Ranking (maksymalnie 7)

| # | Poprawka | Główna korzyść | Ryzyko dla jakości |
|---|---|---|---|
| 1 | **P1** niezawodna publikacja PR-a ✅ wdrożono | run dochodzi do PR-a; 2 z 3 ostatnich runów wymagały ręcznej pomocy [F] | brak |
| 2 | **P2** obsługa limitu użycia | brak strat i draftów przy limicie Pro [F] | brak |
| 3 | **P8** metryki tokenów i tur | podstawa oceny wszystkich zmian | brak |
| 4 | **P3** bramki przez runner + cache | mniej powtórzeń e2e i bramek; obiektywny wynik [H] | średnio-niskie |
| 5 | **P5** ponowne review tylko po blocker/major | jedna sesja Opusa mniej w części runów [F] | niskie |
| 6 | **P4** karta fazy | mniej tur na starcie implementacji [H] | średnio-niskie |
| 7 | **P6** diff bez plików generowanych | mniejszy kontekst review [H] | niskie |

Tuż za rankingiem: P10 (tani bezpiecznik), P9 (mała zmiana) i P7 (większa zmiana skilli, etap 2).

## 3. Rekomendowany zakres pierwszego etapu

**Etap 1a: zmiany mechaniczne w runnerze, bez zmiany zachowania agentów.**
- P1 (✅ wdrożono 2026-10-11), P2, P5, P8, P10;
- P9 (jedna linia w `package.json` i jednorazowe wyrównanie formatowania).

Pliki: `.claude/workflow/{ship,address-pr,lib.sh,config.sh,wf.py}`, `package.json`, `CLAUDE.md`.

**Etap 1b, po jednym runie (S-03) z metrykami z 1a:**
- P3 i P6 (skille `review`/`fix-review` i runner);
- P4 (karta fazy).

**Etap 2, po porównaniu metryk z 2–3 runów:** P7, a potem ewentualnie P11 i P12.

Uzasadnienie: 1a usuwa realne awarie bez dotykania jakości i daje punkt odniesienia. Zmiany, które mogą wpłynąć na jakość, wchodzą dopiero z pomiarem.

## 4. Testy regresyjne i metryki

### Testy regresyjne orchestratora (bez zużywania limitu)

1. **`wf.py`: testy jednostkowe w Pythonie.** Dane wejściowe to istniejące logi jako nagrania:
   - `limit` na `protocol-feasibility-gate/10-review.jsonl`: oczekiwany reset 16:40;
   - `cost` i `report` na sesji typu fork (`connect-companion/09-review.jsonl`): tokeny z `modelUsage`, mimo `num_turns: 0`;
   - `pr-title` na `pr-body.md` z `#` i bez `#` (przypadek S-02);
   - `max-severity`, `run active` (żywy i martwy PID), `brief` na `plan.md` S-02.
2. **Symulator `claude` (nowe).** Skrypt `claude` podstawiony w `PATH` w teście. Zapisuje artefakty według scenariusza (np. „review: APPROVE WITH FOLLOW-UPS”, „implement: limit przy próbie 1”, „push odrzucony”). Kończy się kodem lub zdarzeniem `result` jak prawdziwe CLI. Testy bash całego `ship` na kopii repo w katalogu tymczasowym sprawdzają:
   - review loop: brak drugiego review po samych drobnych uwagach (P5);
   - limit: oczekiwanie (skrócone przez zmienną) i powtórzenie tej samej próby bez draftu (P2);
   - preflight: brak `origin` lub autoryzacji kończy run przed pierwszą sesją (P1);
   - blokada: drugi `ship` przy aktywnym runie się nie uruchamia (P10);
   - `publish_pr`: wywołanie REST z poprawnym tytułem (podstawiony `gh`).
3. **Istniejące testy hooków** (blokada urządzeń, git guard): ponowne uruchomienie bez zmian.

### Metryki (zbierane przez P8, porównanie z F-01, S-01, S-02)

| Obszar | Metryka |
|---|---|
| Limit / tokeny | tokeny na krok i model; zapis cache na sesję; proxy $; ręczny odczyt % limitu Pro przed i po runie |
| Tury i czas | tury na krok; **tury do pierwszego zapisu kodu** (P4); czas na krok; liczba buildów e2e na run (P3) |
| Niezawodność | % runów zakończonych PR-em bez ręcznej pomocy; liczba prób ponownych; zawrócenia Stop hooka; oczekiwania na limit |
| **Jakość (straż)** | liczba i waga uwag review w rundzie 1; uwagi znalezione przez człowieka w PR (komentarze do `address-pr`); wynik mutation na celach; czerwone bramki po fix-review; regresje wykryte w kolejnych pozycjach |

**Kryterium akceptacji zmiany:** spadek tokenów lub czasu przy **niezmienionych** metrykach jakości. Wzrost uwag człowieka w PR albo spadek wyniku mutation oznacza wycofanie zmiany.

## 5. Mechanizmy do pozostawienia bez zmian

- **Nowa sesja na każdy krok i stan w artefaktach.** To podstawa wznawiania. Działało po limicie w S-01 [F].
- **Niezależne review na Opusie w forku**, z weryfikacją każdej uwagi. Znajdowało realne problemy [F].
- **Plan na Opusie** i decyzje D-n z kosztem odwrócenia, a decyzje kosztowne do zmiany ustalane z góry w roadmapie.
- **TDD i szybkie bramki w trakcie fazy implement.** Nie było pętli naprawczych [F].
- **Mutation testing** na celach z planu testów. Wzmocnił asercje w S-01 i S-02 [F].
- **Stop hook** (3 zawrócenia) i **ponowna próba na Opusie.** Tanie zabezpieczenia, rzadko używane [F].
- **Routing modeli** (Opus: plan, recenzja planu, review; Sonnet: reszta).
- **Hooki bezpieczeństwa:** git guard, blokada fizycznych urządzeń, brak pytań w sesjach headless.
- **Ręczne checki i decyzje w PR-ze**, draft PR przy nieukończonym runie, commit na fazę, `address-pr`.

---

**Status:** P1 wdrożono 2026-10-11. Pozostałe propozycje czekają na zatwierdzenie.
