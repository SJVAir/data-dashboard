# SJVAir Data Dashboard

This document is intended to be consumed. It is intended to be used to modify/rebuild our other documents such as CLAUDE.md, ARCHITECTURE.md, ROADMAP.md, and TODO.md, and any other documents which will be used as reference material during the building of this project. All sentiments in this document should be noted in one of our other documents (whichever one makes sense depending on the context)

## Goal

I would like to make this a more interactive, and personal dashboard, as well as a data analytics toolbox for all of the public data we in our server. I'll give you as much information as I can think of, but this is still a developing idea, and will be a rather large project. Please look for gaps in my plans/ideas and interview me to fill those gaps in. I want this to be intuitive for basic users, and feature rich for power users. Since we have both historical and live data on the server, I see this as something that could be used to just monitor data to day things, explore trends local to the region(s) they are viewing, or even monitor live data for alerts. There are 3 targeted audiences for this: everyday community members, schools, and research scholars.

At the moment, I am envisioning 3 views (this can be changed if it makes sense for us to do so), the main dashboard, the widget builder, and analytics toolbox.

I also intend on turning this into a desktop application by using [Tauri](https://github.com/tauri-apps/tauri). We don't have to start this right now, but I would like to keep that in mind and build for it considering it will offer extended capabilities (e.g. larger downloads, offline first, local data storage, tray support, etc.). Investigate the Tauri framework and think about whether or not it makes sense to start building this now. Since Tauri just wraps our vite output I think it might be better to just do it all at once and we can think of the web app as a side effect of building this desktop app. But please investigate this and discus your findings with me. As of this moment writing though, I am leaning towards building it all at once.

## Context

### Sibling Projects

This project will be built utilizing other existing projects, and interfacing with the SJVAir server. These projects were built with a specific intention, but may need to be updated to work with this project. We must make sure that any modifications we make to them will not break their other use cases. Specifically for the map sdk, I expect we will have to make it more modular and configurable. I also expect us to have to make changes to all of these projects at one point or another. Just make sure you have an approved plan before modifying them. Explore them freely to gather better context when planning new features for this project, as we will often utilize all of these.

| Project Reference Name                                        | Project Purpose                                                                                                                                                                                                                                                                       | Project directory              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| server                                                        | The SJVAir server which houses all of our data and user accounts.                                                                                                                                                                                                                     | ~/workspace/sjvair/sjvair.com  |
| sdk                                                           | The TypeScript/JavaScript client sdk for interfacing with the server api                                                                                                                                                                                                              | ~/workspace/sjvair/sdk-js      |
| map sdk (sometimes referred to by it's old name: monitor-map) | The primary map toolkit we will use to build maps in this project. It is also used to build the monitor-map embeded in the server (referenced above), and the map utilized in the SJVAir mobile app. We must keep this in mind when making any modifications we make to it's codebase | ~/workspace/sjvair/monitor-map |

### Stack

The stack is already pretty well defined for this project. There is no additional information to add for the direction change. We are still using the same tools which we have already picked out. We might even add more as needed.

### Theme

We have yet to define a specific theme for the SJVAir ecosystem. Colors and style guides may be derived from the pages and templates in the server. Keep in mind that the server uses Bulma for a css framework and pre-made components, and we will never use the Bulma ecosystem. Make sure you always use tailwind css and shadcn-svelte for pre-built components in this project.

### Style

Elements and components in this project should be built and styled according to modern best practices. Animations for transitions and effects are encouraged. I want it to be clean (not messy), but not pain, boring, or corporate feeling either. Things should be laid out in an intuitive way using common patterns which users should already be accustomed to. We should also strive to have a responsive design. While I don't expect many people to be utilizing their dashboard on devices as small as their phones, I still want to it to be usable.

### Metadata

We have some metadata endpoints which contain extra information about the types of monitors and what data they offer, as well as the pollutant bucket ranges for specific pollutant types (AQI level type buckets). We should reference the metadata as often as possible, as it makes it easy to make some updates across projects simply by updating the metadata on the server. I would like to add more metadata endpoints, and extend existing ones as needed to make things function similarly and act on a single source of truth rather than hard coding values in each project individually and having to keep those in sync.

## Features

### Saving and Sharing Dashboard Configurations

Dashboard configurations should be savable and shareable. This can just be a JSON object with all of the widget types, their locations, dimensions, and each individual widget's configuration. Dashboards should be selectable, at least by a drop down, but ideally I would like to have a nice visual picker to select dashboards. Maybe a drop down will be most intuitive though.

### Dynamic Context Menu (right click menu)

Options in the context menu will vary depending on what was clicked. Options/menus can be nested where it makes organizational sense to do so. This should be an easy system to integrate with. I'm thinking we can have global options (which are always present), and other things can define menu options and those will be consolidated on click. e.g. widgets have a pre defined set of context menu options, and the context menu pulls those in when it is opened on the specific widget. Say if a user right clicks on blank space in the dashboard, maybe a couple options show up like "Add widget" and "Save Dashboard" show up, and when a user right clicks a map widget, we have those previous options pop up, because the dashboard is still relevant context (widget is in dashboard) as well as options defined in the map widget definition (something like "Refresh Map", or "Analyze this data").

An example of something similar to this can be found here:
~/workspace/sjvair/monitor-inventory-tracker/src/lib/components/ContextMenu.svelte

However, I expect this can be greatly optimized and re-architected to work better or more intuitively. Please review it and make any changes to improve it's implementation. We don't need to implement any of that example if you can think of a better way of implementing the Dynamic Context Menu described above.

### Widgets

This list is non-exhaustive, and I would like to brainstorm other widget ideas for displaying and visualizing data.

All widgets should offer context menu options such as "Mark for analysis" to add the data to the current pool of data up for analysis, and "Analyze" which will both add the data to the current pool of data up for analysis as well as navigate the user to the analysis tab.

Widgets should have a title bar which defaults to the name of the datasets included and the date range of the data, but also may be renamed to a custom value by the user.

#### Map

I would like to utilize the map sdk we already have for creating map widgets. I'm sure we will have to make some architectural changes to the map sdk because of this, and that's fine. If it makes sense, maybe we can make it more modular and even add in a basic "plugin" system if it makes configuring things easier. However, I would like the map to have structures in place for displaying all of the types of data we have in the server anyways, since we will most likely be displaying them on the embedded version of the map that is used on the server and mobile app. I'm not too sure how they might select a partial dataset from the map data, so it might be all or nothing for analysing datasets that come from map widgets. I am open to exploring ideas on how they might select partial datasets from existing map widgets if you can think of an intuitive way of achieving this.

#### Calendar

I would like to start with two different calendar options. One is like what we already have, where each day is colored with the average (summary) of that day. The other, I want to be something similar to the contribution graph on Github profiles, but with an adjustable range (github's is always year to date, I want to offer smaller ranges as well, as low as 1 week). A user should be able to highlight a range of days from these, and if the user right clicks on the with a selection made we can have additional context menu options like "Mark selected data for analysis" and "Analyse selected data" in addition to the default whole dataset marking or analyzing.

#### Charts/Graphs

We can utilize [uPlot](https://github.com/leeoniya/uplot) to build any charts or graphs. I believe all of our data is time series, so this one should be pretty straight forward for configuring.

## Views

### Dashboard

This will be the primary view. This is the area with all of the widgets. Widgets can be reorganized via an intuitive drag and drop system, and resized via hovering over an edge or corner similar to how native desktop windows operate. I'm thinking this may also be a scrollable area depending on how

Users should have some way to also add new widgets to the dashboard. We will have a predefined list of widgets (e.g. map, calendar, various types of charts/graphs, plus any others that we can think of together), and this will take them to another tab where they can select which types of data that widget will display (which will be something similar to what we have already implemented)

I think we can have a horizontal navigation bar on top, and the dashboard below that. I want the dashboard to behave similar to a desktop windowing system. Widgets can be moved drag and drop style, resized, "fullscreened" (in which the widget takes up the whole dashboard rather than the actual whole screen), and minimized to a taskbar at the bottom. Should this taskbar become overloaded, it can scroll horizontally to view the remaining. Widgets should auto align (maybe we can leverage css grid system or flexbox if one of those can work with the drag and drop system).

### Widget Creation

What we currently have in this project, I believe, could be used as the basis for the widget creation view. The tabs on the side can become accordions, each containing their respective options. For datasets which are pollutant based (e.g. o3, pm25, etc.) only one pollutant can be selected at at time. We should not allow mixing pollutant datasets inside the same widget. Since all of our data is time series, we can have the date selection above the accordians. Only one date selection may be used within a given widget. We should not allow users to select multiple date ranges for multiple datasets withing the same widget.

I want to offer 3 different methods of date ranges: Set ranges (year, month, week, day), rolling ranges (year to date, month to date, week to date), and custom ranges (user selected). Only one of these methods should be visible at a time, but there should be a method to toggle between them (maybe a drop down if there is nothing more aesthetically pleasing).

A live preview of the widget will be on the right side. The live preview should still be a drag and drop area, and the widget should still be resizable just as they are on the dashboard.

### Analysis

The analysis view is where all of the data analysis tools will live. Please investigate the data available in the server and include common analysis tools. I would like to have 5-10 pre defined analyses to run, but also allow users to define their own in some way. User defined analysis should also be savable and shareable.

I also think it would be cool to integrate JupyterLite in the browser and JupyterLabs for the desktop app. This is the area that will require the most brainstorming.

I would like the analysis section to have some way of managing it's state, so data can be staged for analysis from various widgets on the dashboard.

I will include a small brainstorming session from earlier for reference, as it will provide more info than I can at this point. The short brainstorming session from earlier resolved to:

Prompt: "I have a server with lots of data. It has historical air quality data, fire, smoke, weather, pesticide use (by chemical, region, and commodity), and I think some health data. Almost, if not all, is selectable by date. I want to offer analysis tools for users, but I don't know what is useful, or what I might need to include. Is it possible to let the user select any dataset sorted by date, and compare/contrast (look for trends and patterns) dynamically like that? Or does one need a specific goal in mind first?"

Response: "Both approaches work, but they solve different problems — and the best answer is probably "build the generic tool, but seed it with specific starter analyses."

**Generic cross-dataset explorer (no fixed goal)**
Fully possible: let users pick any two (or more) datasets, auto-align by date, and overlay/correlate them. This is great for exploration and hypothesis generation. But you'll need to solve a few things regardless of which path you pick:

- **Resolution mismatch** — daily AQI vs. monthly pesticide reports vs. annual health stats need aggregation/interpolation rules
- **Geographic mismatch** — county vs. station vs. zip code; you'll need a crosswalk
- **Lag effects** — smoke exposure today might correlate with ER visits 3–5 days later, not same-day; a good tool lets users shift the time axis
- **Spurious correlation** — two unrelated series can look related over the same period; showing correlation coefficients without confidence intervals or a "this is not causation" caveat will mislead people

**Goal-directed tools**
Easier to build well, easier to validate, and much more useful for decisions. E.g., "wildfire smoke days vs. respiratory ER visits by county," or "pesticide application timing vs. specific health outcome in the same commodity region." You know what confounders matter and what the axes should be.

**My actual suggestion:** build the generic date-aligned comparison engine as the underlying capability (it's not that hard — a shared date index, resampling logic, and an overlay chart), but don't launch it as an open-ended "pick anything" tool. Pair it with 5–10 curated starter comparisons based on known or plausible relationships in your data (fire→smoke→AQI→health; pesticide timing→health by region). That gives users a template for what "useful" looks like, while the underlying engine stays flexible enough that they can swap in their own dataset pairs once they get the idea."

Keep in mind, that this was just a brief brainstorm, I only include it to give you more reference since I don't fully know where I am going with this. Please investigate this as well and let me know what you come up with.
