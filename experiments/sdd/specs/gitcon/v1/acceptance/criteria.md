# Acceptance criteria, gitcon-v1

Written before any worker run. The worker never sees this directory. Columns follow the requirement traceability matrix used in the team's ISO 29110 work products: requirement, function mapping, test case, how measured. "Measured by" names the component that produces the verdict; `tests/*.spec.ts` are Playwright tests whose titles start with the AC id, `workflow` means a step of `.github/workflows/sdd-verify.yml` that writes `evidence/*.json`, and `reporter.mjs` merges both into `results.partial.json`.

| AC    | FR    | Spec section | Check                                                                                                                                                                  | Measured by                 |
| ----- | ----- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| AC-01 | FR-08 | 2.2          | `docker build -t sdd-site impl` exits 0                                                                                                                                | workflow, `build.json`      |
| AC-02 | FR-08 | 2.2          | `GET /` returns 200 within 60 s of container start; `/`, `/program`, `/registration-fee`, `/contact`, `/no-such-page` return no 5xx                                    | `tests/layout.spec.ts`      |
| AC-03 | FR-01 | 3.1          | Header has "GIT 2025" linking to `/`; nav links with texts Home, Program, Registration Fee, Contact pointing at the four routes                                        | `tests/layout.spec.ts`      |
| AC-04 | FR-01 | 3.3          | Footer contains the organiser name, "gitconference@git.or.th" as `mailto:`, "(+66) 2634 4999" and the copyright line                                                   | `tests/layout.spec.ts`      |
| AC-05 | FR-02 | 4.1          | Home `<h1>` is "GIT 2025"; page shows the theme, "8 - 9 September 2025" (whitespace-insensitive) and "Bangkok, Thailand"; title tag matches 4.1.1                      | `tests/home.spec.ts`        |
| AC-06 | FR-03 | 4.2.2        | Program has `<h2>` headings equal to both day titles in `program.json`, in order                                                                                       | `tests/program.spec.ts`     |
| AC-07 | FR-03 | 4.2.3        | Each day table has exactly as many body rows as fixture sessions; each row's time, title and speaker cells match the fixture                                           | `tests/program.spec.ts`     |
| AC-08 | FR-04 | 4.3          | Fee page shows both table titles, the column headers, and every cell of `fees.json` including "USD 150", "USD 425", "14,900 Baht"                                      | `tests/fees.spec.ts`        |
| AC-09 | FR-05 | 4.4.2        | Contact form posts to `/contact` and has controls named group (select with the four options), subject, message, name, email, phone, and a submit                       | `tests/contact.spec.ts`     |
| AC-10 | FR-05 | 4.4.3-4.4.4  | Submitting an empty form (group cleared) returns 200 with at least four `[data-error]` messages and no `[data-confirmation]`                                           | `tests/contact.spec.ts`     |
| AC-11 | FR-05 | 4.4.4        | `email=not-an-email` with other fields valid shows `[data-error="email"]` and preserves subject, message, name, phone values                                           | `tests/contact.spec.ts`     |
| AC-12 | FR-06 | 4.4.5-4.4.6  | A valid submission shows `[data-confirmation]` with the subject; `GET /contact/submissions.json` is JSON and contains an object with that subject                      | `tests/contact.spec.ts`     |
| AC-13 | FR-06 | 4.4.6        | A second valid submission makes the array length increase by one; keys are exactly group, subject, message, name, email, phone, submitted_at                           | `tests/contact.spec.ts`     |
| AC-14 | FR-07 | 4.5.1        | `GET /no-such-page` is 404, has the nav, `<h1>` "Page not found" and a link to `/` with text "Back to Home"                                                            | `tests/not-found.spec.ts`   |
| AC-15 | FR-01 | 3.1          | At 375 px on Home the four nav links are visible, or become visible after clicking one button; no horizontal overflow                                                  | `tests/layout.spec.ts`      |
| AC-16 | all   | -            | Full-page screenshot of the five pages at 1280 px saved under `evidence/screenshots/`                                                                                  | `tests/screenshots.spec.ts` |
| AC-17 | FR-08 | 2.3          | `docker run --network none` of the same image serves `GET /` with 200                                                                                                  | workflow, `build.json`      |
| AC-18 | all   | 3.2          | Each of the five pages has exactly one `<h1>`, one `<main>`, and no duplicate `id` attributes                                                                          | `tests/layout.spec.ts`      |
| AC-19 | FR-03 | 4.2.4        | Editing one title in `data/program.json` inside the running container and reloading `/program` shows the new title; "not measurable" when the file is not at that path | `tests/program.spec.ts`     |
| AC-20 | all   | C.3          | `leak-scan.mjs` over the implementation tree finds no marker                                                                                                           | workflow, `leak-scan.json`  |

Spec coverage: an FR counts as implemented when every AC mapped to it passes. Verification pass rate: passed over total, excluding ACs recorded as "not measurable".

Pages for AC-02, AC-16, AC-18: `/`, `/program`, `/registration-fee`, `/contact`, `/no-such-page`.
