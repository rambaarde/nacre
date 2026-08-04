---
name: portal-walk
description: >
  Review varve's portal the way a developer actually uses it — in a real
  browser, walking a real journey, against a memory with real logs in it. Use
  before shipping any change to src/serve.ts, src/portal.ts or the store shape,
  and when the user says "portal walk", "/portal-walk", "review the portal",
  "is this navigable", or reports that something is hard to find.
---

# portal-walk

The portal exists to answer one question: **does a human ever read this?** Every
navigation problem is evidence against the thing the whole project is betting
on, so the portal gets reviewed by using it, not by reading its markup.

Every navigation bug in this project so far was invisible in the diff and
obvious within two clicks.

## The journey

Walk this, in order, as one person:

> I'm a dev. I want to look at my company context, then a project, then a
> teammate's logs — and I keep losing my place.

1. `/` — what does someone see with no idea what this is?
2. company context → **a project** → **that project's standards**
3. → a **teammate's** logs → one of their **individual logs**
4. → search for something that spans two projects
5. back to where you started

Do it by clicking. If a step needs a typed URL, that is the finding.

## Setup

The portal must be serving a memory with **real logs, several people, and more
than one project**. An empty store hides every problem worth finding, and a
one-person one hides half of them.

If there is no such memory to hand, build one: `varve init`, `varve add` two
projects, then write a dozen logs across two or three people and a couple of
months. Twenty minutes, and every review after it is worth having.

```bash
npm run build
node dist/bin/varve.js serve --memory <path-to-a-memory> &
```

It holds the terminal, so background it — and re-check it is alive before
blaming the page for being blank. Then drive it with Playwright:
`browser_navigate`, `browser_snapshot` on `nav.rail` and `nav.tabs`, and
**click** rather than navigating by URL. Typing the URL skips exactly the thing
being tested.

## What to check

**Does the sidebar stay still?** Fetch each page type, strip the
active-highlight class, compare the remaining rail markup. It must be byte
identical. A rail that changes shape between pages moves every target under the
cursor, and it reads as the page rearranging itself.

**Can every page be reached by clicking?** Any page reachable only by typing a
URL does not exist. A project's standards, a person's profile, a single log —
each needs a path in.

**Is anything a dead end?** A page with no way back to its siblings makes people
use the back button as navigation, which means the layout failed.

**Does one label mean one thing?** The same word at two levels — "standards" for
the company and for a project — is ambiguous no matter how it is styled.

**Does anything grow without bound?** Any block assembled from the logs gets
longer forever. Write forty logs into the fixture and look again: a page that is
fine at nine and unusable at fifty is a page that fails exactly when the memory
becomes valuable.

**Is the console clean?** A 404 on every page load teaches people to stop
reading the console, and then a real error goes unseen.

**Does it hold at 375px?** Check the rail, tabs, and any table.

## Reporting

Name the click that produced it, not the file. *"Clicking `ram` makes the rail
jump four rows"* is a finding; *"rail() branches on active.project"* is a
diagnosis, and belongs after it.

Rank by how much navigation is lost, not by how easy the fix looks.

## Holding a fix

A layout assertion rots. Fix each finding with a test on the **property**:

- rail stability → compare stripped markup across page types
- unbounded blocks → write forty logs, assert the page does not grow
- reachability → assert the link exists in the referring page's markup

A screenshot comparison would pass while the rail drifted again. These do not.
