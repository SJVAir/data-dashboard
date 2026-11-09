# Release 1, step 4, spec 4: the "now" widgets and self-monitoring thresholds

Status: approved by the user 2026-11-08 (brainstormed the same day). Built on `step-4-spec-4`
and merged into `step-4` 2026-11-08 (#45, a22e994), on `@sjvair/sdk` 5.0.0-beta.7.

Calls marked **(my call)** are the brainstorming session's own; everything else is the user's.
Mockups shown in the brainstorm: the "Can we go outside?" card (`outside-card.html`, then
`outside-card-v2.html`), the Forecast strip (`forecast-strip.html`), and Current conditions with a
crossed threshold (`current-conditions.html`). They were throwaway; this document is the record.

## Where this sits

Step 4 is seven specs into `step-4`. Specs 1, 2, 3 and 3b are merged (#36, #38, #40, #43), and
`origin/main` was merged into `step-4` for this spec (#44). This spec adds the three "now" widget
types from `ARCHITECTURE.md` → "Widget catalog" (Current conditions, Forecast strip, "Can we go
outside?") and part 1 of "Alerts" (client-side self-monitoring). Calendars and the heatmap are
spec 5; Notes and the starter dashboard are spec 6, and the starter will contain these three
widgets. Server-side alerting is Release 2.

## Why

The rest of the dashboard answers "what happened?". A parent, teacher or coach on a smoky morning
asks "what is it right now, will it be better tomorrow, and can the kids go out?". They should get
that at a glance, in words as well as colors, and the dashboard should tell them when it gets worse
while it's open, without an account.

## Who it's for

- **A teacher before recess:** "Can we go outside?" for their school, read from the SJVAir school
  guidelines, with today's heat.
- **A coach planning practice:** the same card's Athletic Practice row, and tomorrow's forecast.
- **A parent at work with the dashboard open:** Current conditions for their ZIP, a toast and a
  desktop notification when it reaches Unhealthy for Sensitive Groups.
- **Anyone deciding whether to burn wood:** the Forecast strip's burn status.

## Goals

- Three new widget types, each `time: "now"`, `placePicker: true`, lazily loaded, set up through
  Get data.
- Current conditions shows **the same number and level as the SMS alerts** for monitors the server
  evaluates (the user), and a labeled hourly average everywhere else.
- Thresholds on Current conditions and "Can we go outside?" (default Unhealthy for Sensitive
  Groups, the user), with a tile marker, a toast, a polite announcement, a flashing taskbar entry
  when minimized, and an opt-in desktop notification.
- Level-colored threshold lines on the Chart (the user), display only, off by default.

## Non-goals

- Numeric thresholds (deferred since 2026-09-24).
- Server-side alerting, web push, a service worker, or notifications on phones and tablets
  (desktop only in Release 1).
- Calendars, the heatmap, Notes, the starter dashboard (specs 5 and 6); any map code (step 5).
- Collections and "Mark for analysis" (Release 3). The now widgets only declare
  `analyzable: true`; the 3-day trailing window is already recorded in `ARCHITECTURE.md`.
- New guidance content: an ozone set, per-level headlines, a sensitive-groups note, or a combined
  heat and air-quality rule. Any of those comes from the user, not from this spec.

## Anti-goals

- **A number that disagrees with the text message** someone just got. That is why the tile waits
  on the server's stored alert value instead of computing its own.
- **Meaning by color alone.** Every level, threshold, heat score and burn status shows its label.
- **Nagging.** No repeated toasts or notifications while a level holds, none on improvement, no
  permission prompt on page load.
- **Hardcoded levels, colors, guidance, units or zone names.** All of it comes from metadata.
- **Guessing at guidance.** If the school guidelines have no sentences for a level, the card says
  so; it never borrows another level's text.

## Decisions

### Dependency: the server's current alert value (the user, 2026-11-08)

The SMS alert job (`periodic_alerts`, every 10 minutes) computes each monitor's trailing 60-minute
average (at least 50% of expected readings; feeds of an hour or longer use their latest reading if
newer than twice the interval). The alert series is not the published default (PurpleAir and
AirGradient alert on a different calibration, AirNow O3 on raw readings), so a browser average
could disagree with the texts. The user chose to have the server publish the stored result of that
job. Built by the server session (`sjvair-com-7c`), settled with the user 2026-11-08 (field names
may shift slightly in its written spec):

- `GET /api/2.0/monitors/<id>/alerts/current/` →
  `{data: {<entry_type>: {status, value, level, window {start, end}, latest_timestamp, readings, required, previous {status, value, level, latest_timestamp}, evaluated_at}}}`.
  `previous` is the same evaluation as of 60 minutes earlier. Timestamps are ISO strings.
- `status` is `ok`, `insufficient` (coverage under 50%, or an hourly feed's reading too old),
  `no_data`, or `pending` (no stored result yet, such as after a cache restart). `value` and
  `level` are null unless `ok`. Level keys are the `monitors/meta/` scale's keys.
- A pair the job never evaluates is a missing key. **`monitors/meta/` says so beforehand:**
  `monitors.<type>.entries.<entry_type>.alerts` = `{window, min_coverage, stage, processor, expected_interval}`,
  or `null` when the pair isn't evaluated.
- **Hourly feeds** (BAM, AQview, AirNow, AQLite O3) report their latest reading, not an average:
  the window is the last two expected intervals, `required` is 1, and an old reading reads
  `insufficient`.
- Stored in the cache (no migration), expiring after about 30 minutes; `Cache-Control: max-age=60`.
  Hidden monitors are served too, since they are evaluated and texted (the user, in the server
  session). With no stored result, an active monitor reads `pending` and an inactive one
  `no_data`, so the tile needs no `is_active` check.
- The SDK wrapper, `getMonitorAlertCurrent(monitorId)`, and its types arrive in **`@sjvair/sdk`
  `5.0.0-beta.7`** (publishing needs the user's yes, in the SDK session). Moving the dashboard's
  exact pin from beta.6 to beta.7 is part of this spec; the pin change is shown to the user like
  earlier bumps. If the shape changes before beta.7, the coordinator tells this session and the
  plan follows the published shape.
- **The PR waits for beta.7 (the user, 2026-11-08).** Everything else is built first; the
  alert-value path is written and tested against fixtures in the shape above; the beta.7 pin and
  the stack check against the real endpoint are the last steps before asking to merge. The
  session building beta.7 is already running.
- The value can be up to about 10 minutes behind real time. "Updated N min ago" makes that
  visible.

### Which number a tile shows

- **A monitor whose type × pollutant has an `alerts` block:** the alert value above, labeled
  "60-minute average" (the minutes come from the block's `window`, not from code), or "Latest
  reading" for an hourly feed (the block's `expected_interval` is at least its `window`).
- **A monitor with no `alerts` block** (VOZBox, or a pollutant the job doesn't evaluate): its
  latest hourly summary, labeled "Hourly average" (the user).
- **A region, school or point:** the latest hourly summary of the smallest containing region with
  data, resolved as in spec 2 (ZIP → city → county), labeled with its source, for example "PM2.5
  for ZIP 93721 (your location)". Region alerts in Release 2 also read hourly summaries.
- **"Updated N min ago"** uses `latest_timestamp` for alert values and the hour's end for hourly
  summaries, never `is_active`. An hourly summary more than about 3 hours old shows "No recent
  data" instead of a value **(my call; the builder may tune the age)**.

### Current conditions (the user approved the mockup)

- A big value with its unit (metadata `units`, metadata `display.precision`), the level chip
  (`LevelSwatch`-style: the level's color, its label, `readableColor` text, an outline), a trend in
  words ("Rising", "Falling", "Steady") with an arrow, the level's `guidance` line from the scale
  (empty for Good, so nothing shows), and the averaging label with "updated N min ago".
- **Trend:** alert values compare `value` with `previous.value`, and show no trend when
  `previous.latest_timestamp` equals `latest_timestamp` (an hourly feed that hasn't sent a new
  reading yet; decided by the user 2026-11-08); hourly summaries compare the
  latest hour with the one before. The rule for "Steady" (how small a change counts as no change)
  is the builder's, kept in one function and unit-tested.
- **Pollutant control:** the available pollutants from `monitors/meta/` (`available_pollutants`;
  PM2.5 and O3 today), defaulting to `default_pollutant`.
- **States:** loading; "Not available yet" (`pending`); "No recent data" (`no_data`, which covers
  an inactive monitor, or a stale summary); "Not enough recent readings" (`insufficient`); "No data"
  (nothing found for a region, school or point); the existing "no longer available" card for retired or unlisted
  places; error with Retry. The "?" toggletip explains the averaging label.

### Forecast strip (option B, two rows, the user)

- The Valley Air District feed carries **only today and tomorrow** (verified in
  `forecasts/tasks.py`), so the strip has two rows, one per day: the day ("Today", "Tomorrow") with
  its date, the AQI forecast level chip with "AQI 99 · PM2.5" (the forecast's own pollutant), and
  the burn status chip. Each day's latest issue wins, as the forecasts adapter already does.
- **Air Alert banner (the user: "Sure"):** when the district has declared an Air Alert covering
  today or tomorrow, a banner above the rows: "Air Alert declared Mon Nov 9 – Wed Nov 11", from
  `air_alert`, `air_alert_start` and `air_alert_end`. It has a text label, not only a color.
- **Unknown burn status:** the server leaves out the district's third status ("No Burning For
  All") until its feed value is seen. Any status not in the burn scale shows the feed's own
  `burn_status_text` in a neutral chip **(my call)**. It's server text, not generated English.
- **Zone:** the place's forecast zone through `getForecastForPlace`, as Get data's overlays do.
  The label names the zone, and says "nearest zone" when the server's `rule` says the zone came
  from the place's center.
- "Issued Sat 1:42 PM" from `published_at` (Pacific, through `$lib/format`) and the source link
  from the scale's `source`.
- **States:** no forecast yet for today (before the day's issue; shows what's published and says
  so), no forecast for this place (outside the zones), and the shared states.
- No thresholds (a forecast isn't a new reading). `analyzable: true`.

### "Can we go outside?" (option B with full heat text, the user)

- **Always PM2.5**, because `school_guidelines` exists only for PM2.5. No pollutant control.
  The level and value come from the same source as Current conditions.
- **Layout:** the PM2.5 level chip and its source line; then one row per activity in metadata
  order, with its label, its `duration` when not null, and its first sentence cut short. A row
  opens (a disclosure button) to show all of that level's sentences. Below the rows, **"Heat
  today" is never cut:** the CalHeatScore level chip and its full `guidance` (Low has none, so only
  "Heat today: Low" shows). The heat section keeps its room; on a small tile the rows scroll. Then
  the guidelines' `source` link ("Source: Outdoor Activity Guidelines for Schools").
- **Guideline text is shown word for word** from metadata. It's English only by the user's
  earlier decision. The card never assumes a level key exists: if the current level has no
  sentences for an activity, that row says there is no guidance for this level.
- **Heat:** a new heat adapter over `getHeatForPlace` (in the SDK since 4.8.0-beta.4) for today's
  Pacific date. A school uses its linked ZIP, a point its ZIP from the coordinate lookup, a monitor
  its own ZIP (the server's rule). **An area larger than a ZIP shows the highest ZIP score,
  labeled** with the ZIP that set it, for example "Highest in Fresno County (ZIP 93210)" (step 4
  checklist). Levels, colors and guidance come from `calheatscore/meta/`. Heat and air quality stay
  separate: the combined tier bump is still deferred.
- **No PM2.5 for the place:** the card says so and keeps the heat line.
- Thresholds as below. `analyzable: true`.

### Thresholds (self-monitoring)

- **On Current conditions and "Can we go outside?"** (the user). **Level categories only**, picked
  from the pollutant's metadata levels, plus Off: "Tell me at [level] or worse".
- **Default: Unhealthy for Sensitive Groups** (the user), chosen as **the first level with tier 2**
  in the pollutant's scale **(my call)**, so no key is hardcoded. Every scale with levels has one
  today. A pollutant with no levels (PM10) offers no thresholds.
- **Saved** in the widget's existing top-level `thresholds` field (`WidgetInstance.thresholds`,
  already in the document schema and `ARCHITECTURE.md` for this), redefined from
  `unknown[]` to a schema-validated, size-limited entry holding a level key; no entry means Off
  **(my call; the builder settles the exact entry shape)**. If the saved key
  isn't in the scale (a pollutant change, or metadata changed), the widget falls back to the first
  tier-2 level and says so in its settings **(my call)**.
- **What happens when a new value reaches the threshold** (the user approved the mockup):
  - The tile shows an "At your alert level" strip and an outline in the level's color; the outline
    pulses once, or not at all under `prefers-reduced-motion`.
  - One toast naming the widget, place and level, for example "PM2.5 at Fresno - Garland is now
    Unhealthy for Sensitive Groups" (one Paraglide message with parameters, no concatenation).
  - A polite live-region announcement with the same text.
  - A minimized widget's taskbar entry shows the warning mark and outline.
  - A desktop notification with the same text, if the dashboard's switch is on.
- **When it fires (the user approved these rules 2026-11-08):**
  - Only when a newly arrived value is at or above the threshold and **worse than the level last
    told** for that widget. Nothing on improvement; no repeat while a level holds. No daily
    reminder.
  - **The first value sets the starting point** and never toasts or notifies: a new widget, a
    first visit to someone's shared dashboard, a reopened tab, and the Get data preview all show
    only the tile marker if the air is already at the level.
  - **Re-arming:** a value below the threshold that arrives at least 2 hours after the last toast
    clears "last told", so the next crossing tells again. This covers closed periods: a parent told
    yesterday, whose tab sees a clean reading this morning before it worsens, is told again.
  - "Last told" (its level and time) is kept per widget in this browser (a platform preference),
    so a reload doesn't repeat it. The tile marker shows whenever the current level is at or above
    the threshold, told or not. With the dashboard open in two tabs, a crossing toasts
  and notifies once per browser (the builder picks the mechanism: the existing tab channel, a
  lock, or notification `tag`).
- **Minimized widgets** keep refreshing only while their threshold isn't Off (`ARCHITECTURE.md`);
  this applies to the two tiles, not to Chart lines.
- **Shared and live-linked dashboards:** thresholds are part of the widget, so viewers see the
  marker and toast. Desktop notifications depend only on each viewer's own switch.

### The notifications switch (one switch per dashboard, the user)

- "Notify me while this dashboard is open", in the dashboard's ⋯ menu **(my call on placement)**.
- **Stored per browser and per dashboard** (a platform preference), never in the document, so
  opening someone's shared dashboard can't start notifications **(my call)**.
- **Off by default.** Turning it on asks the browser's permission at that moment, never on load.
  If permission is denied, the switch stays off and says how to allow it.
- **Desktop only.** Where the browser can't show notifications without a service worker (phones
  and tablets), the switch is shown disabled with a short reason **(my call)**.
- **A new platform capability, `notifications`** (`permission()`, `request()`, `show({title, body,
  tag})`), with a web implementation and a memory implementation for tests, like `geolocation`.
  Components never call `Notification` directly.

### Chart threshold lines (the user)

- A "Threshold line" option in Get data's More options for a Chart whose main layer is a
  pollutant with levels: Off (the default, the user) or a level.
- Drawn as a horizontal line at the level's lower bound (`min`) in the level's color, labeled with
  the level name. The value axis includes the line, since it's opt-in.
- **Display only:** no toasts, announcements or notifications from Charts (several places and long
  ranges would be noisy). The Data table and CSV are unchanged.
- Saved in the Chart's `thresholds` field, the same entry shape as the tiles **(my call)**; the
  Chart type is display-only, so a minimized Chart doesn't keep refreshing for it. A key missing
  from the scale draws no line and the option says why.

### Get data for "now" widgets

- **Show as** lists the three new types for the datasets they accept: Current conditions and
  "Can we go outside?" accept `["air-quality"]`, the Forecast strip `["forecasts"]` (explicit
  `accepts.datasets`, per spec 3).
- A now type hides **When** and shows **Where** in single mode (the shared picker), then the
  pollutant control (Current conditions), then the alert level (both tiles). The live preview
  works as for other types.
- **Switching Show as between a range type and a now type** keeps the main layer's first place and
  pollutant and drops what the new type can't hold (dates, overlays, extra places). Nothing is
  dropped without a note in the form **(my call)**; the builder picks the note's form.
- **Saved shape:** one layer with `place` (and `entryType` for the two pollutant tiles; the
  Forecast strip's layer is the `forecasts` dataset with no entry type), as the widget-type contract
  says. Thresholds and the Chart line in `thresholds`. Exact field names are the builder's; the
  coordinator and the Map widget session are told the final shape.
- Location privacy as spec 2: points are rounded for lookups and swapped for their region in
  shares and exports.

### Refresh

- Alert values: every 3 minutes (the server reruns every 10; its cache headers are 60 s)
  **(my call)**. Hourly summaries: the existing :55 schedule. Forecasts and heat: hourly **(my
  call)**. All through the existing live-query machinery: one poll per descriptor, paused while
  hidden, backing off on errors.

### Sizes

- About 3 of 12 columns wide by default, like the other types; heights and minimum sizes are the
  builder's, fitting the approved mockups.

### Bundle

- Each widget type, the heat adapter and the threshold logic are lazy. The ⋯ menu item and the
  platform capability are what reach the initial chunk, and the budget has about 0.3 KB of
  headroom. Check `npm run check:budget` after each task that adds imports. If it can't stay under
  200 KB, raise it with the user rather than trimming silently (the budget is soft).

## Accessibility (WCAG 2.2 AA)

- Never color alone: level chips, heat and burn chips, the threshold strip and the Chart line all
  carry text.
- Activity rows are disclosure buttons (`aria-expanded`), reachable and operable by keyboard.
- Threshold crossings announce politely through one persistent live region (the Toggletip
  pattern), never by moving focus.
- The outline pulse and taskbar flash respect `prefers-reduced-motion` (a steady mark instead).
- Text on level colors uses `readableColor`; swatches are outlined.
- The notification switch is a real switch or checkbox with a visible label and its disabled
  reason as visible text.

## Constraints (project rules that bite here)

- Metadata is the source of truth: levels, colors, guidance, units, precision, averaging window,
  zones, guidelines and heat scales.
- Paraglide messages for every string, no concatenation; dates and times through `$lib/format` in
  Pacific time. No generated English in saved documents (only level keys and ids are saved).
- Saved fields schema-validated and size-limited; shapes may be redefined in place before
  Release 1.
- Notifications and preferences through the platform adapter.
- Theme tokens only (the token-discipline test).
- SDK pinned exactly; no SDK workarounds in the dashboard. Anything missing goes to the
  coordinator.

## Testing (what must be shown)

- **Unit:** the number-source choice (alert block present or null, hourly feeds, each status);
  trend; the default and fallback threshold level from tier; the firing rule (escalation, no
  repeat, no improvement message, the first value only sets the starting point, re-arming on a
  below-threshold value 2 hours after the last toast, reload keeps "last told"); heat for a ZIP, a
  school, a point and a county (highest ZIP, labeled); the forecast rows, latest issue, Air Alert
  dates and the unknown burn status; guideline rows when a level key is missing. Run under
  `npm run test:unit:tz` too.
- **Browser:** each widget's states; the activity disclosure; the heat line never truncated; the
  threshold strip, toast and live-region text; reduced motion; the switch's disabled reason; the
  Chart line drawn at the level's `min` with its label.
- **E2E:** Get data's now mode (picker, pollutant control, alert level, preview, Add to
  dashboard); a fixture crossing that toasts once and flashes a minimized taskbar entry; the
  notification switch with a stubbed permission. axe checks on the new widgets.
- **Stack check** against `develop` once beta.7 is pinned: a PurpleAir monitor's tile matching
  `alerts/current/`, a VOZBox monitor's "Hourly average", Roosevelt High's card, and Fresno
  County's strip. Local data is only collected during work hours, so rule out gaps before calling
  stale values a bug.
- `npm run build && npm run check:build && npm run check:budget`; `gh pr checks` after pushing.
- **Copy review:** a fresh-eyes subagent checks each new string where it renders, then the user
  reviews them; the PR lists every key and its English.

## Deferrals (added to `DEFERRED.md` in the same change)

- **Hiding activities on the "Can we go outside?" card.** Offered in the brainstorm; layout B
  shows all four compactly. **Revisit if** schools ask to hide activities they don't have.
- **Thresholds on the Forecast strip** (tomorrow's category or a no-burn day). Release 2's server
  forecast rules cover it with the dashboard closed. **Revisit with** Release 2's rule UI, or if
  people ask for an in-dashboard heads-up.
- **Toasts or notifications from Chart threshold lines.** Display only, to avoid noise. **Revisit
  if** people ask to be told from a Chart.
- **A client-side daily "still bad" reminder.** The server's 10 AM reminder is for texts. **Revisit
  if** people keep a dashboard open all day and ask for one.
- **The third burn status's own level** ("No Burning For All") is already in `DEFERRED.md`
  (deferred 2026-11-03, step 3 spec 1); nothing new is added. The strip shows the feed's text
  meanwhile.
- **A sub-hourly value for regions.** Regions show hourly averages; region alerts in Release 2 use
  the same. **Revisit if** people find region tiles too slow to react.

## Docs changed with this spec

- `ARCHITECTURE.md`:
  - "Alerts" → part 1: the firing rule, the per-browser switch, Charts display only.
  - "Widget catalog": the Forecast strip is today and tomorrow plus the Air Alert banner; the card's
    CalHeatScore needs no SDK work; Current conditions' number source.
  - "Data resolution & live refresh": the alert value's cadence.
  - "Platform strategy": the `notifications` capability.
  - "Saving & sharing documents": `WidgetInstance.thresholds`' entry shape.
- `TODO.md`/`ROADMAP.md`: step 4's sections only (spec 4's status, beta.7).
- `DEFERRED.md` as above.

## Left to the builder

- **Code shape:** components, file names, the adapters' structure (a heat adapter, an alert-value
  path in the air-quality adapter or its own), how thresholds hook into live queries.
- **Small calls:** the "Steady" rule, the stale-summary age, sizes, the dual-tab mechanism, the
  form of the "dropped when switching" note.
- **Wording:** every message. New English strings go to the user with the PR.
