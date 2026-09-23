# SJVAir Data Dashboard — Planning Brief

## Purpose of This Document

This document is intended to be consumed, not just read. Use it to modify or rebuild our other reference documents — CLAUDE.md, ARCHITECTURE.md, ROADMAP.md, TODO.md, and any others used during the build — as well as anything else useful for this project. Every sentiment here should end up reflected in whichever of those documents it fits best.

This is a developing idea for a large project. I want you to look for gaps in my plans, and to interview me to fill those gaps — especially the items listed under **Open Questions** below. Treat that section as the starting point for our brainstorming session, not an afterthought.

### How to Use This Document

Start with the **Open Questions** section and go through it in the order listed. Discuss each item with me and ask follow-up questions where needed — don't just assume an answer and move on. Explore the sibling projects as needed to inform the discussion, especially for the map SDK and context menu questions. Don't write any code or scaffold any files yet. As we resolve each question, update CLAUDE.md, ARCHITECTURE.md, ROADMAP.md, TODO.md, and any other relevant reference documents accordingly before moving on to the next question, rather than saving all the updates for the end.

---

## Vision / Goal

I want to build a more interactive, personal dashboard and a data analytics toolbox for all the public data on our server. Since we have both historical and live data, this should support three kinds of use: monitoring day-to-day conditions, exploring trends local to a region, and staying on top of live data for alerts — both self-monitoring (the dashboard surfaces live data clearly enough that a user can visually catch concerning values as they arrive) and automated alerting (the system proactively notifies the user when values cross a threshold).

Three target audiences: **everyday community members**, **schools**, and **research scholars**. It should be intuitive for basic users and feature-rich for power users.

At the moment I'm envisioning three views — **Dashboard**, **Widget Creation**, and **Analysis** — detailed below. This can change if it makes sense to.

---

## Decided

### Stack

The stack is already well-defined and isn't changing as part of this effort. Reference the existing stack decisions in ARCHITECTURE.md (or wherever they currently live) rather than treating this document as silent on the topic. We may add tools as needed, but nothing is being ripped out.

### Theme & Styling

- No specific SJVAir ecosystem theme exists yet. Colors and style direction may be derived from the pages/templates already in the server.
- The server uses Bulma. **We will never use Bulma** in this project.
- Always use **Tailwind CSS** and **shadcn-svelte** for pre-built components.

### Style Direction

- Modern best practices for components and layout.
- Animations for transitions/effects are encouraged.
- Tone: clean, not messy — but not plain, boring, or corporate either.
- Layouts should use patterns users are already accustomed to.
- Responsive design is required. Phone-sized usage isn't the primary target, but it should still work.

### Charting

Use [uPlot](https://github.com/leeoniya/uplot) for all charts/graphs. Nearly all our data is time series, so this should be a fairly consistent pattern to configure.

### Alerts

The server already has an alert/notification system. We can extend it as needed to support alerting from this dashboard, rather than building a separate system from scratch.

### Metadata as Source of Truth

We have metadata endpoints describing monitor types, what data they offer, and pollutant bucket ranges (AQI level buckets). Reference metadata as often as possible rather than hardcoding values — the goal is a single source of truth that updates propagate from, instead of keeping values in sync by hand across projects. We expect to add new metadata endpoints and extend existing ones as this project surfaces gaps.

### Sibling Projects

This project will be built using, and interfacing with, other existing projects. They were each built with a specific original intent and may need updates to work with this new project — but any changes must not break their existing use cases. Explore them freely for context when planning new features; we'll likely touch all of them at some point. **Get an approved plan before modifying any of them.**

| Project Reference Name           | Project Purpose                                                                                                                                                                                                 | Project Directory                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| server                           | The SJVAir server which houses all of our data and user accounts.                                                                                                                                               | `~/workspace/sjvair/sjvair.com`  |
| sdk                              | The TypeScript/JavaScript client SDK for interfacing with the server API.                                                                                                                                       | `~/workspace/sjvair/sdk-js`      |
| map sdk (formerly "monitor-map") | The primary map toolkit for building maps in this project. Also used to build the monitor-map embedded in the server and the map in the SJVAir mobile app. Keep both other consumers in mind when modifying it. | `~/workspace/sjvair/monitor-map` |

For the map SDK specifically, I expect we'll need to make it more modular and configurable — see the Map widget section and Open Questions below.

---

## Open Questions (interview me on these)

These are the gaps I'm most aware of. Please don't just acknowledge them — actually dig in, ask me follow-up questions, and help me reach decisions before we build against them. I'd like to tackle these somewhat in priority order (roughly as listed), since the Tauri decision in particular affects a lot of downstream architecture choices — but tell me if you think a different order makes more sense.

1. **Tauri now or later?** I intend to eventually turn this into a desktop app using [Tauri](https://github.com/tauri-apps/tauri) — larger downloads, offline-first, local data storage, tray support, etc. We don't have to start immediately, but I want to build with it in mind. Since Tauri just wraps our Vite output, my current lean is to build for Tauri from day one and treat the web app as a side effect of the desktop build — but I want you to actually investigate the framework and push back on that lean if it doesn't hold up, rather than just going along with it.

2. **Map widget partial dataset selection.** I'm not sure how a user would select a _partial_ dataset from a map widget for analysis — it might have to be all-or-nothing. I'm open to ideas for how partial selection from an existing map widget could work intuitively.

3. **Map SDK modularity / plugin system.** I expect we'll need to make the map SDK more modular to support this dashboard's Map widget type, possibly with a basic plugin system to make configuration easier. Since the same map is embedded in the server and used in the mobile app, it also needs structures in place for displaying all the data types we have — not just what this dashboard needs today.

4. **Dashboard layout mechanics.** Widgets should behave like a desktop windowing system: drag-and-drop repositioning, resize via edge/corner hover, "fullscreen" (fills the dashboard area, not the whole screen), and minimize to a horizontally-scrolling taskbar at the bottom. I want widgets to auto-align — possibly via CSS Grid or Flexbox. Is that compatible with free-form drag-and-drop and resizing, or does it push us toward a different layout approach? Also: as more widgets are added and take up more space, should the dashboard area scroll (e.g. horizontally) rather than shrink everything to fit? I lean toward horizontal scrolling but want your take.

5. **Dynamic context menu architecture.** I want a context menu whose options vary by what was clicked, with nesting where organizationally useful, and an easy system for things to register their own options (e.g., widgets define their own menu entries, which get merged with global options and dashboard-level options when relevant). There's a rough prior example at `~/workspace/sjvair/monitor-inventory-tracker/src/lib/components/ContextMenu.svelte` — please review it, but don't treat it as a constraint. I'd like you to think about whether there's a better architecture entirely, and only borrow from the example if it earns its place.

6. **Analysis view — the biggest open area.** This needs the most brainstorming of anything in this document:
   - What are 5–10 good pre-defined analyses to ship with, given the data we actually have (air quality, fire, smoke, weather, pesticide use by chemical/region/commodity, and possibly health data)?
   - What should user-defined analysis creation look like, and how would it be saved/shared?
   - How should staged data work — i.e., data marked for analysis from various dashboard widgets needs some kind of shared state/pool that the Analysis view reads from. What's a good architecture for that?
   - Should we integrate JupyterLite in-browser and JupyterLabs for the desktop app? If so, how does that relate to the staged-data pool and the pre-defined analyses above — are notebooks a separate power-user path, or do they share infrastructure with the rest of the Analysis view? We should also investigate whether their licensing permits this kind of integration before committing to the approach.
   - See "Prior Brainstorm" below for early thinking on the generic-vs-goal-directed analysis question — investigate this further and tell me what you land on.

7. **Metadata gaps.** What metadata endpoints do we already have, and what's missing given everything described in this document? I'd like an audit before we start adding new ones ad hoc.

8. **More widget ideas.** The widget list above (Map, Calendar, Charts/Graphs) is non-exhaustive. I'd like to brainstorm additional widget types for displaying and visualizing data beyond what's already listed.

---

## Features

### Saving and Sharing Dashboard Configurations

Dashboard configurations should be savable and shareable — likely a JSON object describing widget types, positions, dimensions, and each widget's individual configuration. Dashboards should be selectable, at minimum via dropdown; ideally via a nicer visual picker, but a dropdown may end up being the most intuitive option.

### Dynamic Context Menu (Right-Click Menu)

See Open Question #5 for the architecture question. Functionally: options vary based on what was clicked, and can nest where it makes sense. There should be global options (always present) and per-element options that get pulled in and consolidated on click — e.g., right-clicking blank dashboard space might show "Add widget" and "Save Dashboard"; right-clicking a map widget shows those same dashboard-level options _plus_ widget-specific ones like "Refresh Map" or "Analyze this data."

### Widgets

This list is non-exhaustive — I'd like to brainstorm additional widget ideas for displaying and visualizing data.

**Shared widget behavior:**

- All widgets offer context menu options including "Mark for analysis" (adds the widget's data to the current analysis pool) and "Analyze" (adds to the pool _and_ navigates to the Analysis view).
- Widgets have a title bar defaulting to the dataset name(s) and date range, but can be renamed to a custom value by the user.

**Map**
Built on our existing map SDK (see Open Questions #2 and #3 for the architectural questions this raises).

**Calendar**
Two variants to start:

- A day-colored summary calendar (similar to what we already have), where each day's color reflects that day's average.
- A GitHub-contribution-graph-style view, but with an adjustable range (as short as 1 week, unlike GitHub's fixed year-to-date).

Users should be able to highlight a range of days on either calendar. With a range selected, right-clicking should offer additional context menu options — "Mark selected data for analysis" and "Analyze selected data" — alongside the default whole-dataset options.

**Charts/Graphs**
Built with uPlot (see Decided section). Since our data is time series, this should be relatively straightforward to configure per dataset.

---

## Views

### Dashboard (Primary View)

The main view containing all widgets. See Open Question #4 for the open layout-mechanics questions (grid/flexbox vs. free-form, scrolling behavior).

Settled behavior:

- Horizontal navigation bar on top, dashboard area below.
- Widgets: drag-and-drop repositioning, edge/corner-hover resizing, fullscreen (within the dashboard area), minimize to a bottom taskbar that scrolls horizontally when overloaded.
- Users need a way to add new widgets — selecting from a predefined list (map, calendar, various charts, plus whatever else we come up with), which leads into the Widget Creation view to configure the data it displays.

### Widget Creation

Likely based on what we currently have in the current version of the data-dashboard project itself as a starting point, adapted as follows:

- Existing side tabs become accordions, each containing their respective options.
- For pollutant-based datasets (O3, PM2.5, etc.), only one pollutant may be selected per widget — no mixing pollutant datasets within the same widget.
- Date selection sits above the accordions, and only one date range applies per widget (no multiple date ranges for multiple datasets within the same widget). This applies to dashboard display widgets specifically — a future need for comparing datasets with a time offset (e.g. lag effects) belongs to the Analysis view rather than this constraint; see the Analysis section below.
- Three date range methods, only one visible at a time, with a way to toggle between them (dropdown, unless something more elegant fits):
  - **Set ranges**: year, month, week, day
  - **Rolling ranges**: year-to-date, month-to-date, week-to-date
  - **Custom ranges**: user-selected
- A live preview of the widget sits on the right — itself a drag-and-drop and resizable area, matching dashboard behavior.

### Analysis

See Open Question #6 — this is the least settled view and needs the most brainstorming.

What I know so far:

- Should include investigation of the data actually available on the server to inform which analyses make sense.
- Target: 5–10 pre-defined analyses, plus a way for users to define, save, and share their own.
- Needs some form of state management so data can be staged for analysis from various dashboard widgets.
- Comparing datasets with a time offset (e.g. lag effects, per the prior brainstorm below) is expected to live here rather than as a dashboard widget capability — dashboard widgets are constrained to a single date range (see Widget Creation above).
- Possible JupyterLite (browser) / JupyterLabs (desktop app) integration — unresolved, see Open Question #6.

**Prior Brainstorm (reference only — not a settled decision):**

> **Prompt:** "I have a server with lots of data. It has historical air quality data, fire, smoke, weather, pesticide use (by chemical, region, and commodity), and I think some health data. Almost, if not all, is selectable by date. I want to offer analysis tools for users, but I don't know what is useful, or what I might need to include. Is it possible to let the user select any dataset sorted by date, and compare/contrast (look for trends and patterns) dynamically like that? Or does one need a specific goal in mind first?"
>
> **Response:** Both approaches work, but they solve different problems — the suggested path was "build the generic tool, but seed it with specific starter analyses."
>
> A generic cross-dataset explorer (pick any datasets, auto-align by date, overlay/correlate) is good for exploration, but raises real problems regardless of approach: resolution mismatch (daily AQI vs. monthly pesticide reports vs. annual health stats), geographic mismatch (county vs. station vs. zip code crosswalks), lag effects (e.g. smoke exposure today possibly correlating with ER visits days later — needs a shiftable time axis), and spurious correlation (unrelated series can look related over the same period; correlation coefficients need confidence intervals and a "not causation" caveat).
>
> Goal-directed tools (e.g. "wildfire smoke days vs. respiratory ER visits by county") are easier to build well and validate, since the confounders and axes are already known.
>
> The suggestion: build the generic date-aligned comparison engine as the underlying capability (shared date index, resampling logic, overlay chart), but launch it paired with 5–10 curated starter comparisons based on known or plausible relationships in the data (fire→smoke→AQI→health; pesticide timing→health by region) — giving users a template for "useful" while keeping the engine flexible enough for their own dataset pairs later.

This was a brief, early brainstorm — please investigate further and tell me what you land on.
