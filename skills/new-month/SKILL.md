---
name: new-month
description: Tworzy nowy miesiąc w arkuszu czasu pracy, kopiując poprzednią kartę, ustawiając daty i weekendy oraz czyszcząc godziny i opisy. Użyj, gdy użytkownik prosi o nowy miesiąc lub skopiowanie miesięcznej zakładki.
---

# Nowy miesiąc w arkuszu

Używaj wyłącznie dla arkusza `Łukasz Nowak od 17.07.2021` (chyba że podano `TIMESHEET_SPREADSHEET_ID`):

- Spreadsheet ID: `1ikvo-uc5X93LrWnR3r_BK8tutSIG1Mr0M81j7m0NaCk`
- Launcher: `~/.config/opencode/skills/new-month/run.sh`
- Wymagany interpreter: Node >= 18; launcher wybiera zgodną wersję lub używa `NEW_MONTH_NODE`

## Procedura

1. Ustal miesiąc docelowy w formacie `MM.YYYY`. Jeśli użytkownik go nie podał, zapytaj.
2. Domyślnym źródłem jest poprzedni miesiąc. Nie wybieraj źródła na podstawie kolejności kart.
3. Najpierw wykonaj próbę bez zapisu:

```bash
"$HOME/.config/opencode/skills/new-month/run.sh" MM.YYYY --dry-run
```

4. Pokaż użytkownikowi źródło, miesiąc docelowy, liczbę dni oraz wyliczone soboty i niedziele.
5. Po potwierdzeniu wykonaj operację bez `--dry-run`:

```bash
"$HOME/.config/opencode/skills/new-month/run.sh" MM.YYYY
```

6. Jeśli źródłem ma być inna karta niż poprzedni miesiąc, dodaj `--source MM.YYYY`.
7. Przeczytaj zakres `A3:D<ostatni_wiersz>` nowej karty (np. przez MCP Google Drive) i potwierdź wynik; pierwsza formuła kolumny C to `=B5+0`, ostatnia `=B<ostatni_wiersz>+C<ostatni_wiersz-1>`.

## Działanie skryptu

- przerywa bez zmian, jeśli źródło nie istnieje lub karta docelowa już istnieje,
- duplikuje kartę poprzedniego miesiąca na końcu arkusza,
- dopasowuje liczbę wierszy do długości miesiąca,
- wpisuje polską nazwę miesiąca do `B3`,
- ustawia prawdziwe wartości dat w kolumnie A i format `dd-mm-yyyy`,
- odtwarza formuły narastające w kolumnie C: `C5 = B5+0`, `C6 = B6+C5`, …, `Cn = Bn + C(n-1)` (puste `B` wyświetla `0`),
- czyści godziny w kolumnie B i opisy w kolumnie D,
- pobiera wzorce formatowania dnia roboczego, soboty i niedzieli z karty źródłowej,
- rozmieszcza formaty według kalendarza miesiąca docelowego,
- usuwa niekompletną kartę docelową, jeśli operacja po duplikacji zakończy się błędem.

Karta źródłowa służy tylko jako wzór struktury i stylów. Położenie weekendów zawsze wynika z kalendarza miesiąca docelowego.

## Kontrola

Po wykonaniu sprawdź:

- nazwę karty `MM.YYYY` i nazwę miesiąca w `B3`,
- daty od pierwszego do ostatniego dnia miesiąca,
- puste komórki w kolumnach B i D,
- formuły w kolumnie C (`=B5+0`, `=B6+C5`, …),
- formatowanie wszystkich sobót i niedziel.

Nie nadpisuj istniejącej karty i nie usuwaj karty źródłowej.

## Narzędzia pomocnicze (ten katalog)

- `run.sh login` — uruchamia lokalne logowanie Google OAuth i zapisuje tokeny w `~/.local/share/opencode/mcp-auth.json` jako `google-drive.tokens`.
- `run.sh verify MM.YYYY!C5:C8` — czyta formuły przez Sheets API (`valueRenderOption: FORMULA`).
- `run.sh repair MM.YYYY dni` — przepisuje kolumnę C danej karty na poprawne formuły narastające.

## Autoryzacja

Skrypt czyta dane klienta OAuth z `~/.config/opencode/google-credentials.json`
oraz tokeny z `~/.local/share/opencode/mcp-auth.json` (`google-drive.tokens`),
albo zmiennych środowiskowych `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GOOGLE_OAUTH_ACCESS_TOKEN` (opcjonalnie `GOOGLE_OAUTH_REFRESH_TOKEN`, `GOOGLE_OAUTH_EXPIRY_DATE`).
Przy błędzie tokenu ponownie uwierzytelnij MCP `google-drive` w OpenCode albo uruchom:

```bash
"$HOME/.config/opencode/skills/new-month/run.sh" login
```

Jeśli `/mcps` jest puste, użyj `run.sh login`. Domyślny redirect URI helpera to
`http://127.0.0.1:19876/callback`; dla klienta OAuth typu Web application musi
być wpisany w Google Cloud Console jako Authorized redirect URI. Przy błędzie
`redirect_uri_mismatch` dodaj dokładny `Redirect URI:` wypisany przez helper i
uruchom logowanie ponownie.
