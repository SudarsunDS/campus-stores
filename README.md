# Campus Stores

Campus Stores is a Product Engineer work sample set at a fictional campus media equipment desk. Work through a club’s screening, from equipment pickup to a partial return and the next morning’s handover. Open **Candidate brief** in the app for the assignment.

> **Reviewers:** my submission is the write-up below and the prototype in `app.js`, `index.html` and `styles.css`. Open `index.html` and play the same shift with the time control.

---

## My submission: would I keep this product?

**Yes. I would keep its core model and change how it carries a job across a shift change.**

### A moment the product handles well: Friday 3:45 pm pickup

I issued PR-04, SP-02 and AD-12 to Kabir as three separate slips. Then I tried to issue a second adapter (AD-15) on RQ-214, and the desk refused: *“The approved quantity of this equipment type is already on loan.”* When I tried a camera on the same request, it was refused as outside the approved request. PR-06, which is in repair, was never offered.

The **one slip per physical unit** rule is what makes the rest of the shift workable. On Saturday the record says **AD-12**, not just “an adapter”. Without that, nobody could tell which adapter should come back. I kept this model and every existing issue rule unchanged.

### A moment I would change: Friday 7:30 pm → Saturday 9:00 am

Kabir returned the projector and speaker and said Leela had the adapter and would bring it at 9 am. The app had nowhere to record that. Slip L-404 still read *“Kabir Sen · Due Fri 8 pm”*. The only option was a free-text note in a separate Desk book screen, with no link to the slip.

On Saturday the register showed `L-404 · AD-12 / RQ-214 · Kabir Sen · Due Fri 8 pm`. It didn't show the equipment type, Leela, the agreed return time, or that the loan was overdue. Searching for “Leela” found nothing, because her name appeared nowhere in the register. The morning staff member had to piece it together by hand: Desk book → Film Society → RQ-214 → register → L-404 → AD-12. Even then, **“Record return” closed the slip in one click without checking which adapter was actually handed over**. AD-12 and AD-15 sit in the same bin, C4, so a mix-up is easy.

**The product problem:** the app tracks *units* and *notes*, but not the *job*: what a request still owes, who has it now, and when it's coming back. That information is lost at exactly the moment one shift hands over to the next.

### The change: track each request through checkout, partial return and handover

One change at the workflow level, built on top of the existing slips:

1. **Request job view.** Each approved item is shown with the unit issued for it and its status: Not issued, On loan, Due now, Overdue or Returned. The request itself reads *Ready to issue*, *Out*, *2 of 3 back* or *Complete*.
2. **Guided kit checkout.** One form issues the whole kit. The return-by time is pre-filled from the request, and one available unit per approved type is suggested with its bin. Isha's Desk book message authorising Kabir is shown next to the collector field. It still saves **one slip per unit** and applies every original rule.
3. **Structured partial return.** Every open unit must be marked *Back at the counter*, which needs its tag confirmed, or *Still out*, which needs **who has it now** and **when it's expected back**. This updates the slip and automatically writes a linked entry in the Desk book.
4. **Counter lookup with mandatory tag check.** Searching by person, tag, club or request finds the open loan, so “Leela” finds L-404. A loan only closes when the tag on the unit in hand matches. **Entering AD-15 never closes the AD-12 loan.** The message explains where AD-15 is recorded instead.
5. **Open-at-handover summary.** Open loans are grouped by request, with who has each item, overdue and due-now counts based on the desk clock, and the latest handover note.

**Reliability:**
- **All or nothing.** Kit checkout, partial return and check-in are atomic. Each runs against a copy of the records, and only replaces them if every line passes, so a failed save never leaves a half-updated loan.
- **Undo** reverses the last change.
- **Errors appear next to the field** they relate to.
- **Saved data is checked on load.** Earlier saves (version 1) are migrated. Corrupt or inconsistent saves fall back safely to a fresh shift.

### The same job using the change

| Moment | Before | After |
|---|---|---|
| Fri 3:45 pm pickup | 3 separate slip forms (19 interactions), re-picking the request and due time each time; authorisation is on another screen | Open RQ-214 → **Issue kit** → choose Kabir → save. Three slips, about 5 interactions |
| Fri 7:30 pm partial return | Close 2 slips, then type a free-text note somewhere else | **Record return**: projector and speaker back (tags confirmed); adapter *still out with Leela Das, expected Sat 9 am*. The handover note is written automatically |
| Sat 9:00 am handover | Piece it together from 3 screens, then close on trust | **Counter** shows L-404 *With Leela Das · Due now*. Search “Leela” → **Check in** → AD-15 is rejected, AD-12 closes L-404 → RQ-214 **Complete** |

### What I kept

One slip per physical unit, all original issue rules, the fictional records, the three-step shift timeline, the Inventory, Loan register and Desk book screens, offline single-page operation, and the light and dark themes. No framework, backend or build step was added.

### What I would watch at a real counter

On Saturday morning, **can the staff member close the right slip without opening the Desk book or asking the returner “who did you borrow it for?”** I'd measure the time from the returner giving their name to the correct slip being closed. As a check, I'd track how often the weekly stock count finds an adapter whose physical tag doesn't match its slip. If the change works, both numbers should fall.

### Limitations

- Tag verification is a typed field. A real desk would use a barcode scanner, and staff could still copy the tag from the screen.
- Overdue status uses the simulated desk clock, not real dates.
- Who is allowed to collect for a club is shown from the Desk book, not enforced as a rule.
- Before publishing, I checked the full scenario with a quick smoke test in headless Chrome: kit issued, partial return saved, Leela found, AD-15 refused, AD-12 closed, no JavaScript errors, and no horizontal scrolling at phone width. A fuller automated test suite was not completed before the deadline.

---

## Run the app

Open `index.html` in a modern browser. The app includes its scripts, styles, and icons and can run offline.

To serve it over local HTTP, run this from the repository folder and visit `http://localhost:8000`.

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Each browser stores its own sample shift locally when browser storage is available. **Restart sample shift** restores the fictional starting records.

## Source

- `index.html` contains the desk layout, candidate brief, and bundled icons.
- `app.js` contains the sample records, the request lifecycle, validation, atomic record changes, and persistence.
- `styles.css` defines the desktop and mobile layouts.

Icon license notices are in [third-party/lucide-LICENSE.txt](third-party/lucide-LICENSE.txt).

## Submit your work

1. [Fork Campus Stores](https://github.com/virinchi-healthcare/campus-stores/fork) into your GitHub account. Complete the candidate brief and push your changes to your public fork. In your README, point reviewers to your work and explain the decision you made.
2. In your fork, open **Commits**, select the final commit you want reviewed, and copy the page URL. It should look like `https://github.com/YOUR-USERNAME/campus-stores/commit/COMMIT-SHA`.
3. [Submit your work through the Google Form](https://docs.google.com/forms/d/e/1FAIpQLScvzoh1R4WS-SkiwAVBQbMvniieJYSoOEfLMyVo5CyjOvYUgQ/viewform). Your **roll number**, **email ID**, and **final commit link from your public fork** are required. Enter your roll number and email ID in the form only.
