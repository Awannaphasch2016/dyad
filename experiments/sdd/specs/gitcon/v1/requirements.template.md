# GIT 2025 Conference Website, Public Pages

Specification version: gitcon-v1. This document is complete and fixed. Build exactly what it says; where it is silent, use the Assumptions section, and where that is silent too, choose the simplest option and record the choice.

## 1. Purpose

A small public website for "GIT 2025, The 8th International Gem and Jewelry Conference" with four pages and one form: Home, Program, Registration Fee, Contact. English only. Content comes from this document and from the two JSON fixtures reproduced in section 6, which must be shipped as files and read at request time.

## 2. Runtime contract

| #   | Requirement                                                                                                                                           | Reference    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 2.1 | The site is served by PHP 8.2 or newer. Any Composer package or no framework at all is acceptable.                                                    | FR-08        |
| 2.2 | One `Dockerfile` at the repository root builds the site; `docker build -t site . && docker run -p 8080:80 site` serves it on container port 80.       | FR-08        |
| 2.3 | The container needs no network access at runtime and no external service (no database server, no mail, no CAPTCHA, no analytics, no CDN assets).      | FR-08        |
| 2.4 | Fixture files are shipped at `data/program.json` and `data/fees.json` with the exact content of section 6, and the pages read them on every request.  | FR-03, FR-04 |
| 2.5 | Stored contact messages live under `data/` inside the container, as a SQLite file or as JSON lines; the directory must be writable by the web server. | FR-06        |

## 3. Page structure shared by every page (FR-01)

### 3.1 Header

| #   | Element       | Description                                                                                                                                    |
| --- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Event name    | The text "GIT 2025" as a link to `/`.                                                                                                          |
| 2   | Navigation    | Links with exactly these texts, in this order: Home (`/`), Program (`/program`), Registration Fee (`/registration-fee`), Contact (`/contact`). |
| 3   | Small screens | At a viewport width of 375 px the four links are either visible or revealed by one button; no horizontal scrolling.                            |

### 3.2 Body

The page-specific content described in section 4, under a single `<h1>`. One `<main>` element per page. Every `id` attribute on a page is unique.

### 3.3 Footer

| #   | Element   | Description                                                                                                                   |
| --- | --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | Organiser | "The Gem and Jewelry Institute of Thailand (Public Organization)"                                                             |
| 2   | Address   | "140, 140/1-3, 140/5 ITF - Tower Building, 1st - 4th and 6th Floor, Silom Road, Suriyawong, Bangrak, Bangkok 10500, Thailand" |
| 3   | Phone     | "(+66) 2634 4999 ext. 451-457"                                                                                                |
| 4   | Fax       | "(+66) 2634 4970"                                                                                                             |
| 5   | Email     | "gitconference@git.or.th" as a `mailto:` link                                                                                 |
| 6   | Copyright | "Copyright © 2025. All rights reserved. The Gem and Jewelry Institute of Thailand (Public Organization)."                     |

## 4. Pages

### 4.1 Home, `GET /` (FR-02)

| #     | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1.1 | `<title>` is "Home - GIT 2025 Responsible Gem & Jewelry Supply Chain".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4.1.2 | The `<h1>` is "GIT 2025". Directly below it the theme "Responsible Gem & Jewelry Supply Chain", the dates "8 - 9 September 2025" and the place "Bangkok, Thailand" are shown as separate lines.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 4.1.3 | Three paragraphs, verbatim: (a) "The Gem and Jewelry Institute of Thailand (public organization) or GIT has proudly hosted the Gem and Jewelry Conferences since 2006. Each event has been met with the warmest reception and overwhelming success. The past conferences have not only served as academic platforms but also as networking forums for peers, academia, and industry experts." (b) "This year, the 8th International Gem and Jewelry Conference (GIT 2025) will welcome you to Bangkok with the theme 'Responsible Gem & Jewelry Supply Chain'. The theme was chosen with the main purpose of bringing together experts, academics, and industry professionals to exchange knowledge and ideas on the development of the gem industry, the use of environmentally friendly technology, and the creation of a sustainable supply chain." (c) "The conference will take place in Bangkok, Thailand, from September 8 - 9, 2025. Attendees will also have the opportunity to participate in the 72nd Bangkok Gem and Jewelry Fair, held concurrently." |
| 4.1.4 | A link to `/registration-fee` with the text "Registration Fee" and a link to `/program` with the text "Program" appear in the body in addition to the navigation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### 4.2 Program, `GET /program` (FR-03)

| #     | Requirement                                                                                                                                                                                                           |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.2.1 | `<h1>` is "Program".                                                                                                                                                                                                  |
| 4.2.2 | One section per entry of `days` in `data/program.json`, in file order, with an `<h2>` equal to the day's `title`.                                                                                                     |
| 4.2.3 | Each section holds one `<table>` with a header row "Time, Title, Speaker, Affiliation, Room" and one body row per session in file order. Cells show the session fields unchanged; empty fields render as empty cells. |
| 4.2.4 | Nothing from the program is hardcoded in templates: changing a title in `data/program.json` and reloading changes the page.                                                                                           |

### 4.3 Registration Fee, `GET /registration-fee` (FR-04)

| #     | Requirement                                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.3.1 | `<h1>` is "Registration Fee".                                                                                                                                            |
| 4.3.2 | One `<table>` per entry of `tables` in `data/fees.json`, preceded by an `<h2>` equal to its `title`. The header row is `columns`; body rows are `rows`, cells unchanged. |
| 4.3.3 | Below the tables the sentence "All fees include conference materials, lunches and coffee breaks on both days."                                                           |

### 4.4 Contact, `GET /contact` and `POST /contact` (FR-05, FR-06)

| #     | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.4.1 | `<h1>` is "Contact". The organiser name, address, phone, fax and email from section 3.3 are repeated in the body above the form.                                                                                                                                                                                                                                                                                                                                                                            |
| 4.4.2 | A `<form method="post" action="/contact">` with these controls, each with a `<label>` whose text is given here and a `name` attribute given in brackets: Group [`group`] as a `<select>` with options General, Registration, Abstract Submission, Sponsorship; Subject [`subject`] text input; Message [`message`] textarea; Full Name [`name`] text input; Email [`email`] email input; Phone Number [`phone`] text input; a submit button "Send".                                                         |
| 4.4.3 | Server-side validation on POST, independent of any HTML5 attribute: group must be one of the four options; subject, message, name, email are required and non-blank after trimming; email must contain exactly one "@" with at least one character on each side and a "." after the "@"; phone is optional and, when present, must consist of digits, spaces, "+", "-", "(" and ")" only.                                                                                                                   |
| 4.4.4 | On a validation failure the response is HTTP 200 with the same form, every previously entered value preserved in its control, and one error message directly after each failing control, in an element with the attribute `data-error="<field name>"`. The messages are "Please select a group", "Please enter a subject", "Please enter a message", "Please enter your full name", "Please enter a valid email", "Please enter a valid phone number". No confirmation text appears on a failed submission. |
| 4.4.5 | On success the message is stored (section 2.5) with the submitted fields and a server timestamp in ISO 8601 UTC, and the response is HTTP 200 showing the `<h1>` "Contact" and a confirmation block with the attribute `data-confirmation` containing the text "Thank you, your message has been sent." followed by the submitted subject.                                                                                                                                                                  |
| 4.4.6 | `GET /contact/submissions.json` returns `Content-Type: application/json` and a JSON array of all stored messages in submission order, each an object with keys `group`, `subject`, `message`, `name`, `email`, `phone`, `submitted_at`. Empty store returns `[]`.                                                                                                                                                                                                                                           |
| 4.4.7 | No email is sent, no CAPTCHA, no rate limiting.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### 4.5 Not found (FR-07)

| #     | Requirement                                                                                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.5.1 | Any path other than those in sections 4.1 to 4.4 returns HTTP 404 with the shared header and footer, an `<h1>` "Page not found" and a link to `/` with the text "Back to Home". |
| 4.5.2 | Methods other than GET on pages 4.1 to 4.3 and 4.5, and other than GET or POST on `/contact`, return HTTP 405.                                                                  |

## 5. Assumptions

Use these to answer questions you would otherwise ask a person.

1. Trailing slashes are equivalent: `/program` and `/program/` serve the same page.
2. Static assets (CSS, images) may live under `/assets/`; they are not pages and do not need the 404 layout.
3. Styling is free; vanilla CSS, no CSS framework pulled from a CDN. A system font stack is fine.
4. The Group select has no empty placeholder option; "General" is selected by default on first view.
5. Stored messages persist for the life of the container only.
6. Tests inside the repository are welcome but not required.
7. Do not add pages, languages, logins, search, downloads, galleries, or any feature not listed here.

## 6. Fixtures

Ship these two files byte-for-byte as `data/program.json` and `data/fees.json`.

### 6.1 `data/program.json`

```json
{{PROGRAM_JSON}}
```

### 6.2 `data/fees.json`

```json
{{FEES_JSON}}
```

## 7. Requirement index

| FR    | Summary                                                  | Sections    |
| ----- | -------------------------------------------------------- | ----------- |
| FR-01 | Shared header, navigation, footer, responsive navigation | 3           |
| FR-02 | Home content                                             | 4.1         |
| FR-03 | Program rendered from fixture                            | 4.2, 6.1    |
| FR-04 | Fees rendered from fixture                               | 4.3, 6.2    |
| FR-05 | Contact form and validation                              | 4.4.1-4.4.4 |
| FR-06 | Storage, confirmation, submissions endpoint              | 4.4.5-4.4.7 |
| FR-07 | 404 and 405 behaviour                                    | 4.5         |
| FR-08 | Docker, PHP 8.2+, no network, fixtures as files          | 2           |
