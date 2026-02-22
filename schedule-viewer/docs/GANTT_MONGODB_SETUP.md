# Gantt Chart + MongoDB Setup

This guide explains how the Gantt chart works with MongoDB and how to get a chart like the reference (one row per person, time on the X-axis, date shown, blue/yellow/gray bars).

---

## How it was set up (data flow)

1. **Login**  
   When you log in, the app stores a JWT and calls `loadCurrentSchedule(token)`.

2. **Loading the schedule**  
   `loadCurrentSchedule` in `App.js` does:
   - `POST /api/current-schedule` with `{ token }`.
   - The backend verifies the token, reads the **username**, and queries MongoDB:
     - **Collection:** `resource_schedules`
     - **Query:** find the **latest** document where `resource_name` matches the username (case-insensitive).
   - The backend returns `{ username, scenario_name, tasks }`, with each task having a `person` field (from that document’s `resource_name`).

3. **Gantt tab: multi-person (like the reference image) or just me**  
   - When you open the **Gantt Chart** tab, the app also calls `POST /api/all-resource-schedules` with your token. The backend returns **all resources’ tasks** in the same scenario as you (from MongoDB `resource_schedules`), so you get multiple rows (tom, jane, debbie, annie, etc.) like the reference photo.
   - The Gantt tab has two modes (toggle at the top):
     - **All resources** (default): uses `allResourcesSchedule.tasks` from `/api/all-resource-schedules` — same scenario, everyone in one chart.
     - **Just me**: uses `currentSchedule.tasks` from `/api/current-schedule` — only your row.
   - **View Schedule** tab uses only `currentSchedule` (your schedule).

4. **Time range**  
   The Gantt chart shows **8:00–24:00 (midnight)**. Tasks are clamped so no bar extends past midnight; anything after 24:00 is cut off at the end of the day.

So: **all events on the Gantt tab come from MongoDB `resource_schedules`** — either everyone in your scenario (“All resources”) or just your document (“Just me”).

---

## Where do the events come from? (DB vs mock)

| Place in the app | Source of events |
|------------------|------------------|
| **Gantt Chart tab** (after login) | **Only from the database.** Default view “All resources” uses `POST /api/all-resource-schedules` → all docs in MongoDB `resource_schedules` for your scenario (or latest per resource). “Just me” uses `POST /api/current-schedule` → your doc in `resource_schedules`. If there’s no data in `resource_schedules`, the Gantt is empty. |
| **View Schedule tab** | Same as above: **only from the database** (`resource_schedules`). |
| **Add a Task → “Choose Your Preferred Schedule”** (the cards with Gantt on each option) | **Not from the database.** Those options come from `POST /api/schedule` (when you submit the “Add New Task” form). The backend then calls `generate_mock_schedules()` and returns **mock** tasks (hardcoded in `server.py`). So the Gantt on those cards is for comparing fake options; saving one copies that schedule into the `schedules` collection, but the **Gantt and View Schedule tabs** read from `resource_schedules`, not from `schedules`. |

**Summary:** The **Gantt Chart** and **View Schedule** tabs show only events that exist in **MongoDB `resource_schedules`**. Those events are usually created by your scheduler (e.g. `run_initial_schedule.py`), which runs the solver and writes one `resource_schedules` document per person with that person’s `tasks` (each with `task_name`, `start_lb`, `end_lb`). If you’ve never run that (or a similar) script for your username, the Gantt will be empty.

---

## Where the data lives

- **Collection: `resource_schedules`**  
  Used for “current schedule” and for the **Gantt** and **View Schedule** tabs when you’re logged in.

- **Document shape:**
  ```json
  {
    "scenario_name": "p3_w3_scenario",
    "resource_name": "annie",
    "tasks": [
      {
        "task_name": "dentalappointment",
        "start_lb": "2025-05-20T15:00:00.000Z",
        "end_lb": "2025-05-20T15:30:00.000Z"
      }
    ],
    "created_at": "<ISO datetime>"
  }
  ```

- One document per **person** (resource). Each document has a `tasks` array.  
- **`start_lb` / `end_lb`**: ISO date-time strings. The chart uses them for time-of-day (X-axis) and can show the date (e.g. “May 20, 2025”) above the chart.

## Task fields the Gantt chart uses

| Field        | Required | Description |
|-------------|----------|-------------|
| `task_name` | Yes      | Label on the bar / in tooltip. |
| `start_lb`  | Yes      | Start time (ISO string). |
| `end_lb`    | Yes      | End time (ISO string). |
| `person`    | No*      | Row label (e.g. "annie"). If missing, backend adds `resource_name` from the document. |
| `color`     | No       | Hex color (e.g. `#3b82f6`). If missing, color is derived from `task_name`: travel → gray, pickup/dropoff → yellow, else blue. |

\* Backend now adds `person` from `resource_name` when returning current schedule, so the Gantt always has a row label.

## How the backend serves the Gantt

- **Endpoint:** `POST /api/current-schedule` with `{ "token": "<jwt>" }`.
- **Behavior:** Finds the latest `resource_schedules` document for the logged-in user (`resource_name` matched to username), then returns:
  - `tasks`: each task gets a `person` field set from that document’s `resource_name` (if not already set).
- So the frontend always receives tasks that have both datetime fields and a person for the row.

## How GanttChart.js uses the data

- **Input:** `tasks` (array from API) and optional `defaultPerson`, `dateLabel`.
- **Two task formats are supported:**
  1. **MongoDB style:** `task_name`, `start_lb`, `end_lb` (and optional `person`, `color`).  
     The chart converts these to internal “start (hours from 8am)” and “duration” and shows the date from the first task’s `start_lb` if you don’t pass `dateLabel`.
  2. **Mock/options style:** `taskName`, `start`, `duration` (hours), optional `person`, `color`.  
     Used on “Add a Task” → schedule options. No date unless you pass `dateLabel`.
- **Date:** Shown above the chart from `dateLabel` or from the first task’s `start_lb`.
- **Colors:** If `color` is missing, the chart uses the same rules as the day view: travel → gray, pickup/dropoff → yellow, else blue.

**Time range:** The chart runs from **8:00 to 24:00 (midnight)**. In `GanttChart.js`, tasks are clamped so that no bar extends past midnight: `start` and `duration` are limited so `start + duration ≤ 16` (16 = midnight in “hours from 8am” units). So you always see up to midnight and never past it.

So: **you don’t need to change MongoDB document shape** for the current single-user Gantt. As long as `resource_schedules` has `resource_name` and `tasks` with `task_name`, `start_lb`, and `end_lb`, the chart will look like the reference (one row per person, time 08:00–24:00, date on top, colored bars, nothing past midnight).

## Showing multiple people (like the reference image)

This is now the **default** on the Gantt tab.

- **`POST /api/all-resource-schedules`** returns tasks for **all resources** in the same scenario as the logged-in user (or, if the user has no scenario, the latest schedule per resource). Each task has `person` set from its document’s `resource_name`.
- On the **Gantt Chart** tab, **“All resources”** (default) uses this endpoint so you see one row per person, like the reference photo. Use **“Just me”** to narrow to your row only.

## Optional: storing “type” (e.g. buffer vs task) in MongoDB

If you want to drive blue vs yellow (or more types) from the database instead of from `task_name`:

- Add a field on each task, e.g. `"type": "task" | "buffer" | "travel"`.
- When writing tasks (scheduler or script), set `type` accordingly.
- In `GanttChart.js`, in `normalizeTask`, if `task.type` is present, map it to a color (e.g. buffer → yellow, travel → gray, task → blue) and use that instead of `getTaskColor(task_name)`.

Your current setup (color from `task_name`) already gives blue/yellow/gray without any schema change.
