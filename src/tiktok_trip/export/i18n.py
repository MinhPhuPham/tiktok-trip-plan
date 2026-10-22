"""English and Vietnamese labels for trip.xlsx and map.html, plus language-aware time formatting."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from tiktok_trip.clock import DAY_MINUTES, EN_DASH, to_minutes
from tiktok_trip.models import BestTime, Category, Center, Hours, OpeningPeriod
from tiktok_trip.priority import LEVELS, STARS

TIME_PATTERN = re.compile(
    rf"\b(?P<start>[0-2]?\d:[0-5]\d)(?:\s*[-{EN_DASH}]\s*(?P<end>[0-2]?\d:[0-5]\d))?\b"
)


EN_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


@dataclass(frozen=True)
class Labels:
    code: str
    twelve_hour: bool
    date_format: str
    title: str
    weekdays: tuple[str, ...]
    daily: str
    open_from: str
    open_24h: str
    best_time: str
    best_inline: str
    heuristic: str
    center: str
    center_missing: str
    source: str
    zone: str
    warning: str
    directions_link: str
    leg: str
    day: str
    dashboard_sheet: str
    plan_sheet: str
    totals: Mapping[str, str]
    categories: Mapping[Category, str]
    center_sources: Mapping[str, str]
    directions: Mapping[str, str]
    no_direction: str
    center_area: str
    stop_kinds: Mapping[str, str]
    plan_title: str
    solver_method: str
    agent_method: str
    rest_at_hotel: str
    rest_at_center: str
    not_planned: str
    day_units: tuple[str, str]
    groupings: Mapping[str, str]
    travel_modes: Mapping[str, str]
    no_plan: str
    glance_columns: tuple[str, ...]
    summary_columns: tuple[str, ...]
    plan_columns: tuple[str, ...]
    priorities: Mapping[str, str]
    tags: Mapping[str, str]
    """Label of every tag id in tags.TAGS ("late_night" -> "late night" / "ăn khuya")."""
    tags_title: str
    best_time_why: str
    open_24h_daily: str
    closed_days: str
    months: tuple[str, ...]
    """Jan ... Dec in the sheet's language ("T1" ... "T12" in Vietnamese)."""
    best_days: Mapping[str, str]
    """best_time.days words ("weekend", "weekday")."""
    kinds: Mapping[str, str]
    """Nearby spot kinds (OSM tourism / historic / amenity values, Google's tourist_attraction)."""
    unplaced_codes: Mapping[str, str]
    """Why a place is left out of the plan (planning.schema.UNPLACED_CODES)."""
    map_ui: Mapping[str, str]
    """Chrome of map.html: tabs, filters, layer names, popup captions."""

    def day_count(self, count: int) -> str:
        return f"{count} {self.day_units[0] if count == 1 else self.day_units[1]}"

    def direction(self, sector: str | None) -> str:
        return self.directions.get(sector or "", self.no_direction)

    def priority(self, priority: str | None) -> str:
        return self.priorities.get(priority or "", "")

    def priority_legend(self, *, include_must: bool = False) -> str:
        """'★★★ high · ★★ medium · ★ low' in the sheet's language, '★★★★ must go' first if asked."""
        levels = LEVELS if include_must else LEVELS[1:]
        return " · ".join(f"{STARS[level]} {self.priorities[level].lower()}" for level in levels)


EN = Labels(
    code="en",
    twelve_hour=True,
    date_format="%Y-%m-%d",
    title="{city} trip plan — generated {date}",
    weekdays=("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"),
    daily="daily",
    open_from="from {time}",
    open_24h="open 24 hours",
    best_time="Best time",
    best_inline="best",
    heuristic="estimate",
    center="CENTER",
    center_missing="Center not computed yet",
    source="Source",
    zone="Zone",
    warning="Warning",
    directions_link="Directions",
    leg="Leg {leg}",
    day="Day {day}",
    dashboard_sheet="Dashboard",
    plan_sheet="Plan-to-go",
    totals={
        "places": "Places",
        "without_direction": "Without direction",
        "zones": "Zones",
        "videos": "Videos",
        "pending_review": "Pending review",
        "high_priority": "High priority",
        "must_go": "Must go",
    },
    categories={
        Category.FOOD: "Food",
        Category.CAFE: "Cafe",
        Category.ATTRACTION: "Attraction",
        Category.OTHER: "Other",
    },
    center_sources={
        "hotel": "Hotel",
        "override": "Chosen manually",
        "city_default": "City default",
    },
    directions={
        "N": "North of center",
        "NE": "Northeast of center",
        "E": "East of center",
        "SE": "Southeast of center",
        "S": "South of center",
        "SW": "Southwest of center",
        "W": "West of center",
        "NW": "Northwest of center",
    },
    no_direction="No direction",
    center_area="Center",
    stop_kinds={
        "start": "Start",
        "place": "Place",
        "nearby": "Nearby spot",
        "rest": "Rest",
        "end": "End",
    },
    plan_title="{city} plan to go — {days} · {method} · {mode}",
    solver_method="grouped by {grouping} · optimised by solver",
    agent_method="planned by Claude Code",
    rest_at_hotel="Rest at hotel",
    rest_at_center="Rest at center",
    not_planned="Not planned",
    day_units=("day", "days"),
    groupings={"sector": "direction", "nearest": "nearest zones"},
    travel_modes={"walking": "walking", "motorbike": "motorbike", "car": "car"},
    no_plan="Plan not generated yet: run tiktok-trip route",
    glance_columns=("Activity", "Place", "Time", "Note"),
    summary_columns=(
        "Day",
        "Areas",
        "Stops",
        "Start",
        "End",
        "Total time (min)",
        "Travel time (min)",
        "Directions",
    ),
    plan_columns=(
        "Day",
        "#",
        "Activity",
        "Place",
        "Priority",
        "Type",
        "Area",
        "Arrive",
        "Leave",
        "Time there (min)",
        "Travel to next (min)",
        "Open hours",
        "Best time",
        "Tags",
        "Price",
        "Note",
    ),
    tags={
        "breakfast": "breakfast",
        "lunch": "lunch",
        "dinner": "dinner",
        "snack": "snack",
        "late_night": "late night",
        "view": "view",
        "dessert": "dessert",
        "garden": "garden",
        "work_friendly": "work-friendly",
        "sunset": "sunset",
        "sunrise": "sunrise",
        "cloud_hunting": "cloud hunting",
        "photo_spot": "photo spot",
        "family": "family",
        "nature": "nature",
        "history": "history",
        "shopping": "shopping",
        "service": "service",
    },
    tags_title="Good for",
    best_time_why="Why this time",
    open_24h_daily="open 24 hours daily",
    closed_days="closed {days}",
    months=EN_MONTHS,
    best_days={"weekend": "weekend", "weekday": "weekday"},
    kinds={
        "place_of_worship": "Temple / pagoda",
        "museum": "Museum",
        "viewpoint": "Viewpoint",
        "attraction": "Sight",
        "tourist_attraction": "Sight",
        "artwork": "Public art",
        "historic": "Historic site",
        "yes": "Historic site",
        "monument": "Monument",
        "memorial": "Memorial",
        "building": "Historic building",
        "castle": "Palace / castle",
        "manor": "Old villa",
        "church": "Church",
        "ruins": "Ruins",
        "archaeological_site": "Archaeological site",
        "wayside_shrine": "Shrine",
        "tomb": "Tomb",
        "park": "Park",
        "garden": "Garden",
    },
    unplaced_codes={
        "out_of_days": "No room in the trip days",
        "too_far": "Too far for this trip",
        "low_priority": "Lower priority, no time left",
        "closed": "Closed on the trip days",
        "out_of_window": "Opening hours do not fit the day plan",
        "other": "Left out",
    },
    priorities={"must": "Must go", "high": "High", "medium": "Medium", "low": "Low"},
    map_ui={
        "plan": "Plan",
        "address": "Address",
        "center": "Center",
        "place_count": "{n} places",
        "dir_N": "North",
        "dir_NE": "Northeast",
        "dir_E": "East",
        "dir_SE": "Southeast",
        "dir_S": "South",
        "dir_SW": "Southwest",
        "dir_W": "West",
        "dir_NW": "Northwest",
        "places": "Places",
        "search": "Search places",
        "search_placeholder": "Name, address or dish",
        "day": "Day",
        "all": "All",
        "not_planned": "Not planned",
        "all_days": "All days",
        "priority": "Priority",
        "unrated": "Not rated",
        "must_go": "Must go",
        "category": "Category",
        "count": "{shown} of {total} places",
        "no_results": "Nothing matches these choices. Try removing a filter.",
        "intents": "Good for",
        "intents_clear": "Clear",
        "clear_filters": "Clear filters",
        "intent_breakfast": "Breakfast",
        "intent_lunch": "Lunch",
        "intent_dinner": "Dinner",
        "intent_snack": "Snacks & sweets",
        "intent_late_night": "Late-night food",
        "intent_cafe": "Coffee & chill",
        "intent_sunrise": "Sunrise",
        "intent_clouds": "Cloud hunting",
        "intent_sunset": "Sunset",
        "intent_night": "Night views",
        "intent_view": "Views",
        "intent_photo": "Photo spots",
        "intent_nature": "Nature & gardens",
        "intent_family": "Family",
        "intent_history": "History",
        "intent_shopping": "Shopping",
        "reset": "Reset",
        "show_day": "Show only this day",
        "stop_1": "{n} stop",
        "stops": "{n} stops",
        "unplaced": "Left out of the plan",
        "layers": "Layers",
        "basemap": "Basemap",
        "overlays": "On the map",
        "rays_rings": "Directions and distance rings",
        "nearby": "Nearby spots",
        "routes": "Day routes",
        "legend": "Legend",
        "pin_size": "Pin size shows priority",
        "open_maps": "Open in Google Maps",
        "video": "Video {n}",
        "hours": "Hours",
        "price": "Price",
        "must_try": "Must try",
        "rating": "Rating",
        "ratings": "{n} ratings",
        "show_list": "Show list",
        "hide_list": "Hide list",
        "fit_all": "Show all places",
        "language": "Language",
        "generated": "Generated {date}",
        "sells_out": "sells out by {time}",
        "tags": "Good for",
        "best_time_why": "Why this time",
        "estimate": "estimate",
        "tiles_failed": "{name} tiles could not load here; switched to {next}.",
        "map_error": "The map could not load. Check the internet connection; the plan and the "
        "places list still work.",
        "google_error": "Google Maps could not load. Check that the Maps JavaScript API is "
        "enabled for the key. Switched to {next}.",
        "loading_google": "Loading Google Maps…",
        "basemap_openfreemap": "OpenFreeMap",
        "basemap_esri_streets": "Streets",
        "basemap_osm": "OpenStreetMap",
        "basemap_esri_satellite": "Satellite",
        "basemap_google": "Google",
        "map_label": "Map of {city}",
        "photos": "Photos",
        "photo_by": "Photos:",
        "lightbox_label": "Photos of {name}",
        "photo_prev": "Previous photo",
        "photo_next": "Next photo",
        "photo_position": "{n} of {total}",
        "open_video": "Watch the video",
        "hide": "Hide",
        "unhide": "Show again",
        "hidden_badge": "Hidden",
        "hidden_count": "{n} hidden",
        "show_hidden": "show",
        "hide_hidden": "hide them",
        "hidden_toast": "Hidden {name}.",
        "restored_toast": "{name} is back.",
        "undo": "Undo",
        "other_places": "Other places",
        "export_prefs": "Export preferences.yaml",
        "export_prefs_hint": "Save it as input/preferences.yaml (hidden places go under removed), "
        "then run {command}.",
        "prefs_saved": "preferences.yaml saved ({n} removed).",
        "cluster": "{n} places here, zoom in",
        "cluster_legend": "Groups: the ring shows the category mix",
        "offline": "You are offline. Map areas you have not opened before stay blank.",
        "online": "Back online.",
        "routes_approximate": "Some routes are approximate",
        "routes_approximate_failed": "Some routes are approximate (routing service unavailable)",
        "edit_plan": "Edit plan",
        "done": "Done",
        "save_failed": "This browser blocked saving. Export plan.json to keep the changes.",
        "add_place": "Add place",
        "add_rest": "Add rest",
        "add_day": "Add day",
        "remove_day": "Remove day",
        "remove": "Remove",
        "move_up": "Move up",
        "move_down": "Move down",
        "move_to_day": "Move to day",
        "slot_label": "Part of day",
        "no_slot": "No slot",
        "note": "Note",
        "drag": "Drag to reorder",
        "reset_plan": "Reset to generated plan",
        "export_plan": "Export plan.json",
        "export_help": "To make this plan the trip's plan, put plan.json in the project's "
        "data/plan/ folder (replace the old file), then run:",
        "export_after": "It checks the plan again, recomputes the times and rebuilds trip.xlsx "
        "and map.html.",
        "export_has_errors": "Fix the red problems first: route --collect rejects a plan that has "
        "them.",
        "keyboard_hint": "Alt+↑/↓ moves a stop, Alt+←/→ (or Shift+Alt+←/→) moves it to another "
        "day, Delete removes it, Ctrl+Z undoes.",
        "to_fix": "{n} to fix",
        "day_stats": "{places} places · {travel} min on the road · back {end}",
        "leg": "{n} min",
        "leg_estimate": "~{n} min",
        "wait": "waits {n} min",
        "leave_center": "Leave {name}",
        "back_center": "Back at {name}",
        "rest_stop": "Rest at the center",
        "empty_day": "No stops yet. Add a place or drag one here.",
        "picker_title": "Add to day",
        "move_here": "Move here",
        "add": "Add",
        "close": "Close",
        "only_unplanned": "Not planned yet",
        "planned_day": "Day {n}",
        "closed_today": "Closed",
        "open_today": "Open {hours}",
        "add_to_day": "Add to day…",
        "unplaced_default_reason": "removed in the map editor",
        "stale_draft": "Saved edits belong to an older version of this plan.",
        "restore_draft": "Restore them",
        "discard_draft": "Discard",
        "announce_moved": "{name}: day {day}, position {pos}",
        "announce_removed": "{name} removed",
        "announce_added": "{name} added to day {day}",
        "install_app": "Install app",
        "install_title": "Install this trip",
        "install_why": "It opens from your home screen and works offline.",
        "install_confirm": "Install",
        "install_not_now": "Not now",
        "install_got_it": "Got it",
        "install_ios_share": "Tap {icon} Share in the browser toolbar (or under •••).",
        "install_ios_add": "Scroll down, choose {icon} Add to Home Screen, then tap Add.",
        "install_ios_share_safari": "Tap {icon} Share in Safari's bottom bar (iPad: top right).",
        "install_ios_share_safari26": "Tap ••• in Safari's bottom bar, then {icon} Share.",
        "install_ios_share_chrome": "Tap {icon} Share at the right end of the address bar (or ••• "
        "→ Share).",
        "install_ios_share_edge": "Tap ••• in the bottom bar, then {icon} Share.",
        "install_ios_share_firefox": "Tap the ≡ menu, then {icon} Share (or Share in the address "
        "bar).",
        "installed_toast": "Installed. Open the trip from your home screen.",
        "install_menu_open": "Open the browser menu {icon}.",
        "install_menu_add": "Choose Install app or Add to Home screen.",
        "install_dock": "In the menu bar, choose File, then Add to Dock.",
        "install_in_app": "Zalo, Facebook and similar apps open links in their own browser, "
        "which can't install apps.",
        "install_in_app_open": "Tap ••• or ⋮ and choose Open in browser.",
        "install_in_app_then": "In {browser}, tap Install app again.",
        "install_copy_hint": "Can't find it? Copy the link and paste it into {browser}.",
        "install_safari_only": "Before iOS 16.4 only Safari installs web apps. Open this page in "
        "Safari to install it: copy the link and paste it into Safari.",
        "install_unsupported": "This browser can't install web apps. "
        "Open this page in Chrome or Edge to install it.",
        "install_copy_link": "Copy link",
        "install_copied": "Link copied",
        "install_link": "Trip link",
        "peek_prev": "Previous stop",
        "peek_next": "Next stop",
        "peek_prev_place": "Previous place",
        "peek_next_place": "Next place",
        "peek_no_match": "Nothing matches",
        "place_1": "{n} place",
        "my_location": "My location",
        "locate_finding": "Finding your location…",
        "locate_centre": "Show where you are and follow",
        "locate_following": "Following you. Tap to turn location off",
        "locate_shown": "Showing your location",
        "locate_followed": "The map follows you",
        "locate_off": "Location off",
        "locate_blocked": "Location is blocked. Tap to see how to allow it",
        "locate_retry": "Couldn't find your location. Tap to try again",
        "locate_failed": "Couldn't find your location. Try again near a window or outdoors.",
        "locate_blocked_title": "Location is blocked",
        "locate_blocked_why": "This browser doesn't let the map use your location.",
        "locate_steps_site": "Tap the icon left of the address (ⓘ or the "
        "lock) → Permissions or Site settings → Location → Allow.",
        "locate_steps_device": "Location must also be on for the browser in the device settings.",
        "locate_file": "Opened as a file, this map may not "
        "get your location. Open the trip link (https) instead.",
        "locate_privacy": "Your position stays on this device: it is never sent or saved.",
        "locate_this_browser": "this browser",
        "locate_ios_app_why": "Your iPhone doesn't let {app} use location, so this page can't ask "
        "you.",
        "locate_refused_why": "Location was refused when the page asked.",
        "locate_safari_blocked_why": "Safari blocks location for this page, so it can't ask you.",
        "locate_webapp_why": "The app on your Home Screen has its own location permission, "
        "separate from the browser.",
        "locate_ios_app_settings": "Open Settings → Apps → {app} → Location.",
        "locate_ios_app_settings_old": "Open Settings → {app} → Location.",
        "locate_ios_while_using": "Choose While Using the App and turn on Precise Location.",
        "locate_back_retry": "Come back and tap Try again (or reload the page).",
        "locate_ios_reload_allow": "Reload the page, tap the location button and choose Allow "
        "when asked.",
        "locate_safari_websites": "Settings → Privacy & Security → Location Services → Safari "
        "Websites → While Using the App, with Precise Location on.",
        "locate_safari_settings": "Settings → Apps → Safari → Location → Ask or Allow.",
        "locate_safari_settings_old": "Settings → Safari → Location → Ask or Allow.",
        "locate_safari_site": "On this page: tap aA (or •••) by the address → Website Settings → "
        "Location → Allow.",
        "locate_webapp_settings": "Settings → Privacy & Security → Location Services: on, then "
        "this app (or Safari Websites) → While Using the App.",
        "locate_webapp_readd": "Still blocked? Remove the app from the Home Screen, add it again, "
        "then choose Allow when asked.",
        "locate_off_title": "Can't get your location",
        "locate_off_why_ios": "Your iPhone returned no position: Location Services may be off.",
        "locate_off_why": "Your device returned no position: its location setting may be off.",
        "locate_ios_services": "Open Settings → Privacy & Security → Location Services and turn "
        "it on.",
        "locate_ios_services_app": "Just below, choose {app} → While Using the App.",
        "locate_ios_services_safari": "Just below, choose Safari Websites → While Using the App.",
        "locate_ios_services_webapp": "Just below, choose this app (or Safari Websites) → While "
        "Using the App.",
        "locate_off_device": "Turn on Location (GPS) in the device settings, then tap Try again.",
        "from_you": "{d} from you",
        "max_days": "A trip plan has at most 7 days",
        "closed_warning": "Closed that day. Hours: {hours}",
        "closing_warning": "Arrives {time} with no time left before closing (needs {need} min). "
        "Hours: {hours}",
        "past_end_warning": "Leaves {time}, after the day ends at {end}",
        "deadline_warning": "Arrives {time}, after its {deadline} deadline (sells out or closes "
        "early)",
        "duplicate_warning": "Planned {n} times; keep it in one day",
        "unknown_warning": "'{ref}' is not a known place or nearby spot",
        "unknown_slot_warning": "Part of day '{slot}' is not in the rhythm",
        "missing_slot_warning": "No part of day set",
        "slot_category_warning": "A {category} place in the {slot} slot",
        "slot_order_warning": "{slot} comes after a later part of the day",
        "long_leg_warning": "{n} min on the road to get here",
        "long_leg_back_warning": "{n} min back to the center",
        "long_wait_warning": "Waits {n} min before it starts at {time}",
        "best_time_warning": "Arrives {time}, outside its best time {best}",
        "directions_warning": "Mixes {a} and {b} ({deg}° apart) in one day",
        "late_return_warning": "Back at the center at {time}, after {end}",
        "too_many_days_warning": "Day {n} is past trip.days ({days}): raise trip.days in "
        "config.yaml or move these stops",
        "max_places_warning": "{n} places, over the limit of {max}",
        "max_nearby_warning": "{n} nearby spots, over the limit of {max}",
        "must_unplaced_warning": "Must go, but not in the plan",
        "no_errors": "Nothing to fix",
        "announce_undone": "Undone",
        "undo_hint": "Undo with Ctrl+Z.",
        "announce_slot": "{name}: {slot}",
        "announce_note": "Note updated for {name}",
        "announce_times": "Day {day} now ends back at {end}",
        "announce_day_removed": "Day {n} removed. {count} stops moved to {unplaced}.",
        "announce_reset": "Back to the generated plan",
        "picker_source": "Places or nearby spots",
        "why_first": "Already the first stop",
        "why_last": "Already the last stop",
    },
)

VI = Labels(
    code="vi",
    twelve_hour=False,
    date_format="%d/%m/%Y",
    title="Kế hoạch chuyến đi {city} — tạo ngày {date}",
    weekdays=("T2", "T3", "T4", "T5", "T6", "T7", "CN"),
    daily="hàng ngày",
    open_from="từ {time}",
    open_24h="mở cửa 24 giờ",
    best_time="Giờ đẹp",
    best_inline="giờ đẹp",
    heuristic="ước tính",
    center="TRUNG TÂM",
    center_missing="Chưa tính trung tâm",
    source="Nguồn",
    zone="Khu",
    warning="Cảnh báo",
    directions_link="Chỉ đường",
    leg="Chặng {leg}",
    day="Ngày {day}",
    dashboard_sheet="Tổng Hợp",
    plan_sheet="Lịch Trình",
    totals={
        "places": "Địa điểm",
        "without_direction": "Chưa có hướng",
        "zones": "Khu",
        "videos": "Video",
        "pending_review": "Chờ duyệt",
        "high_priority": "Ưu tiên cao",
        "must_go": "Phải đi",
    },
    categories={
        Category.FOOD: "Ăn uống",
        Category.CAFE: "Cà phê",
        Category.ATTRACTION: "Tham quan",
        Category.OTHER: "Khác",
    },
    center_sources={
        "hotel": "Khách sạn",
        "override": "Tự chọn",
        "city_default": "Mặc định của thành phố",
    },
    directions={
        "N": "Phía bắc trung tâm",
        "NE": "Phía đông bắc trung tâm",
        "E": "Phía đông trung tâm",
        "SE": "Phía đông nam trung tâm",
        "S": "Phía nam trung tâm",
        "SW": "Phía tây nam trung tâm",
        "W": "Phía tây trung tâm",
        "NW": "Phía tây bắc trung tâm",
    },
    no_direction="Chưa xác định hướng",
    center_area="Trung tâm",
    stop_kinds={
        "start": "Xuất phát",
        "place": "Địa điểm",
        "nearby": "Điểm lân cận",
        "rest": "Nghỉ ngơi",
        "end": "Kết thúc",
    },
    plan_title="Lịch trình {city} — {days} · {method} · {mode}",
    solver_method="chia theo {grouping} · tối ưu bằng thuật toán",
    agent_method="lập bởi Claude Code",
    rest_at_hotel="Nghỉ ngơi tại khách sạn",
    rest_at_center="Nghỉ ngơi tại trung tâm",
    not_planned="Chưa xếp lịch",
    day_units=("ngày", "ngày"),
    groupings={"sector": "hướng", "nearest": "khu gần nhau"},
    travel_modes={"walking": "đi bộ", "motorbike": "xe máy", "car": "ô tô"},
    no_plan="Chưa có lịch trình: hãy chạy tiktok-trip route",
    glance_columns=("Hoạt động", "Địa điểm", "Thời gian", "Ghi chú"),
    summary_columns=(
        "Ngày",
        "Khu vực",
        "Số điểm",
        "Bắt đầu",
        "Kết thúc",
        "Tổng thời gian (phút)",
        "Di chuyển (phút)",
        "Chỉ đường",
    ),
    plan_columns=(
        "Ngày",
        "#",
        "Hoạt động",
        "Địa điểm",
        "Ưu tiên",
        "Loại",
        "Khu vực",
        "Đến",
        "Rời",
        "Thời gian ở (phút)",
        "Di chuyển tiếp (phút)",
        "Giờ mở cửa",
        "Giờ đẹp",
        "Nhãn",
        "Giá",
        "Ghi chú",
    ),
    tags={
        "breakfast": "ăn sáng",
        "lunch": "ăn trưa",
        "dinner": "ăn tối",
        "snack": "ăn vặt",
        "late_night": "ăn khuya",
        "view": "view đẹp",
        "dessert": "đồ ngọt",
        "garden": "sân vườn",
        "work_friendly": "ngồi làm việc",
        "sunset": "hoàng hôn",
        "sunrise": "bình minh",
        "cloud_hunting": "săn mây",
        "photo_spot": "check-in",
        "family": "gia đình",
        "nature": "thiên nhiên",
        "history": "lịch sử",
        "shopping": "mua sắm",
        "service": "dịch vụ",
    },
    tags_title="Phù hợp cho",
    best_time_why="Vì sao giờ này",
    open_24h_daily="mở cửa 24/24",
    closed_days="đóng cửa {days}",
    months=("T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12"),
    best_days={"weekend": "cuối tuần", "weekday": "ngày thường"},
    kinds={
        "place_of_worship": "Chùa, đền",
        "museum": "Bảo tàng",
        "viewpoint": "Điểm ngắm cảnh",
        "attraction": "Điểm tham quan",
        "tourist_attraction": "Điểm tham quan",
        "artwork": "Tác phẩm nghệ thuật",
        "historic": "Di tích",
        "yes": "Di tích",
        "monument": "Tượng đài",
        "memorial": "Đài tưởng niệm",
        "building": "Công trình cổ",
        "castle": "Dinh thự, lâu đài",
        "manor": "Biệt thự cổ",
        "church": "Nhà thờ",
        "ruins": "Phế tích",
        "archaeological_site": "Di chỉ khảo cổ",
        "wayside_shrine": "Miếu",
        "tomb": "Lăng mộ",
        "park": "Công viên",
        "garden": "Vườn",
    },
    unplaced_codes={
        "out_of_days": "Không đủ ngày",
        "too_far": "Quá xa cho chuyến này",
        "low_priority": "Ưu tiên thấp hơn, hết thời gian",
        "closed": "Đóng cửa vào các ngày đi",
        "out_of_window": "Giờ mở cửa không hợp lịch trình",
        "other": "Không đưa vào lịch trình",
    },
    priorities={"must": "Phải đi", "high": "Cao", "medium": "Vừa", "low": "Thấp"},
    map_ui={
        "plan": "Lịch trình",
        "address": "Địa chỉ",
        "center": "Trung tâm",
        "place_count": "{n} địa điểm",
        "dir_N": "Bắc",
        "dir_NE": "Đông Bắc",
        "dir_E": "Đông",
        "dir_SE": "Đông Nam",
        "dir_S": "Nam",
        "dir_SW": "Tây Nam",
        "dir_W": "Tây",
        "dir_NW": "Tây Bắc",
        "places": "Địa điểm",
        "search": "Tìm địa điểm",
        "search_placeholder": "Tên, địa chỉ hoặc món",
        "day": "Ngày",
        "all": "Tất cả",
        "not_planned": "Chưa xếp lịch",
        "all_days": "Tất cả các ngày",
        "priority": "Ưu tiên",
        "unrated": "Chưa đánh giá",
        "must_go": "Phải đi",
        "category": "Loại",
        "count": "{shown} / {total} địa điểm",
        "no_results": "Không có nơi nào khớp lựa chọn này. Thử bỏ bớt bộ lọc.",
        "intents": "Gợi ý cho",
        "intents_clear": "Bỏ chọn",
        "clear_filters": "Xóa bộ lọc",
        "intent_breakfast": "Ăn sáng",
        "intent_lunch": "Ăn trưa",
        "intent_dinner": "Ăn tối",
        "intent_snack": "Ăn vặt",
        "intent_late_night": "Ăn khuya",
        "intent_cafe": "Cà phê chill",
        "intent_sunrise": "Đón bình minh",
        "intent_clouds": "Săn mây",
        "intent_sunset": "Ngắm hoàng hôn",
        "intent_night": "Ngắm cảnh đêm",
        "intent_view": "Ngắm cảnh",
        "intent_photo": "Chụp ảnh",
        "intent_nature": "Thiên nhiên & vườn",
        "intent_family": "Gia đình",
        "intent_history": "Di tích",
        "intent_shopping": "Mua sắm",
        "reset": "Đặt lại",
        "show_day": "Chỉ xem ngày này",
        "stop_1": "{n} điểm dừng",
        "stops": "{n} điểm dừng",
        "unplaced": "Chưa đưa vào lịch trình",
        "layers": "Lớp bản đồ",
        "basemap": "Nền bản đồ",
        "overlays": "Hiển thị",
        "rays_rings": "Hướng và vòng khoảng cách",
        "nearby": "Điểm lân cận",
        "routes": "Lộ trình theo ngày",
        "legend": "Chú thích",
        "pin_size": "Kích thước ghim theo mức ưu tiên",
        "open_maps": "Mở trong Google Maps",
        "video": "Video {n}",
        "hours": "Giờ mở cửa",
        "price": "Giá",
        "must_try": "Nên thử",
        "rating": "Đánh giá",
        "ratings": "{n} lượt đánh giá",
        "show_list": "Hiện danh sách",
        "hide_list": "Ẩn danh sách",
        "fit_all": "Xem tất cả địa điểm",
        "language": "Ngôn ngữ",
        "generated": "Tạo ngày {date}",
        "sells_out": "hết hàng trước {time}",
        "tags": "Phù hợp cho",
        "best_time_why": "Vì sao giờ này",
        "estimate": "ước tính",
        "tiles_failed": "Không tải được nền {name}; đã chuyển sang {next}.",
        "map_error": "Không tải được bản đồ. Hãy kiểm tra kết nối mạng; lịch trình và danh sách "
        "địa điểm vẫn dùng được.",
        "google_error": "Không tải được Google Maps. Hãy kiểm tra khóa đã bật Maps JavaScript "
        "API. Đã chuyển sang {next}.",
        "loading_google": "Đang tải Google Maps…",
        "basemap_openfreemap": "OpenFreeMap",
        "basemap_esri_streets": "Đường phố",
        "basemap_osm": "OpenStreetMap",
        "basemap_esri_satellite": "Vệ tinh",
        "basemap_google": "Google",
        "map_label": "Bản đồ {city}",
        "photos": "Ảnh",
        "photo_by": "Ảnh:",
        "lightbox_label": "Ảnh của {name}",
        "photo_prev": "Ảnh trước",
        "photo_next": "Ảnh tiếp theo",
        "photo_position": "{n}/{total}",
        "open_video": "Xem video",
        "hide": "Ẩn",
        "unhide": "Hiện lại",
        "hidden_badge": "Đã ẩn",
        "hidden_count": "{n} đã ẩn",
        "show_hidden": "hiện",
        "hide_hidden": "ẩn đi",
        "hidden_toast": "Đã ẩn {name}.",
        "restored_toast": "Đã hiện lại {name}.",
        "undo": "Hoàn tác",
        "other_places": "Địa điểm khác",
        "export_prefs": "Xuất preferences.yaml",
        "export_prefs_hint": "Lưu thành input/preferences.yaml (địa điểm đã ẩn nằm trong removed), "
        "rồi chạy {command}.",
        "prefs_saved": "Đã lưu preferences.yaml ({n} bị loại).",
        "cluster": "{n} địa điểm ở đây, phóng to để xem",
        "cluster_legend": "Nhóm: vòng màu cho biết các loại địa điểm",
        "offline": "Đang ngoại tuyến. Vùng bản đồ chưa mở trước đó sẽ trống.",
        "online": "Đã có mạng trở lại.",
        "routes_approximate": "Một số tuyến đường chỉ là ước lượng",
        "routes_approximate_failed": "Một số tuyến đường chỉ là ước lượng "
        "(không tải được đường đi)",
        "edit_plan": "Sửa lịch trình",
        "done": "Xong",
        "save_failed": "Trình duyệt này chặn việc lưu. Hãy xuất plan.json để giữ thay đổi.",
        "add_place": "Thêm địa điểm",
        "add_rest": "Thêm nghỉ ngơi",
        "add_day": "Thêm ngày",
        "remove_day": "Xóa ngày",
        "remove": "Bỏ",
        "move_up": "Lên trên",
        "move_down": "Xuống dưới",
        "move_to_day": "Chuyển sang ngày",
        "slot_label": "Khung giờ",
        "no_slot": "Không có khung giờ",
        "note": "Ghi chú",
        "drag": "Kéo để sắp xếp",
        "reset_plan": "Khôi phục lịch trình gốc",
        "export_plan": "Xuất plan.json",
        "export_help": "Để dùng lịch trình này cho chuyến đi, đặt plan.json vào thư mục "
        "data/plan/ của dự án (thay file cũ), rồi chạy:",
        "export_after": "Lệnh này kiểm tra lại lịch trình, tính lại giờ và tạo lại trip.xlsx và "
        "map.html.",
        "export_has_errors": "Hãy sửa các lỗi màu đỏ trước: route --collect không nhận lịch trình "
        "còn lỗi.",
        "keyboard_hint": "Alt+↑/↓ để di chuyển điểm dừng, Alt+←/→ (hoặc Shift+Alt+←/→) để chuyển "
        "sang ngày khác, Delete để bỏ, Ctrl+Z để hoàn tác.",
        "to_fix": "{n} lỗi cần sửa",
        "day_stats": "{places} địa điểm · {travel} phút di chuyển · về lúc {end}",
        "leg": "{n} phút",
        "leg_estimate": "~{n} phút",
        "wait": "chờ {n} phút",
        "leave_center": "Rời {name}",
        "back_center": "Về {name}",
        "rest_stop": "Nghỉ ngơi tại trung tâm",
        "empty_day": "Chưa có điểm dừng. Thêm địa điểm hoặc kéo vào đây.",
        "picker_title": "Thêm vào",
        "move_here": "Chuyển sang đây",
        "add": "Thêm",
        "close": "Đóng",
        "only_unplanned": "Chưa xếp lịch",
        "planned_day": "Ngày {n}",
        "closed_today": "Đóng cửa",
        "open_today": "Mở {hours}",
        "add_to_day": "Thêm vào ngày…",
        "unplaced_default_reason": "đã bỏ trong trình sửa bản đồ",
        "stale_draft": "Các thay đổi đã lưu thuộc phiên bản cũ của lịch trình này.",
        "restore_draft": "Khôi phục",
        "discard_draft": "Bỏ qua",
        "announce_moved": "{name}: ngày {day}, vị trí {pos}",
        "announce_removed": "Đã bỏ {name}",
        "announce_added": "Đã thêm {name} vào ngày {day}",
        "install_app": "Cài ứng dụng",
        "install_title": "Cài chuyến đi này",
        "install_why": "Mở ngay từ màn hình chính và dùng được khi không có mạng.",
        "install_confirm": "Cài đặt",
        "install_not_now": "Để sau",
        "install_got_it": "Đã hiểu",
        "install_ios_share": "Bấm {icon} Chia sẻ trên thanh công cụ của trình duyệt "
        "(hoặc trong •••).",
        "install_ios_add": "Kéo xuống, chọn {icon} Thêm vào MH chính rồi bấm Thêm.",
        "install_ios_share_safari": "Bấm {icon} Chia sẻ ở thanh dưới cùng của Safari (iPad: góc "
        "trên bên phải).",
        "install_ios_share_safari26": "Bấm ••• ở thanh dưới cùng của Safari rồi chọn {icon} Chia "
        "sẻ.",
        "install_ios_share_chrome": "Bấm {icon} Chia sẻ ở đầu phải thanh địa chỉ (hoặc ••• → Chia "
        "sẻ).",
        "install_ios_share_edge": "Bấm ••• ở thanh dưới cùng rồi chọn {icon} Chia sẻ.",
        "install_ios_share_firefox": "Bấm menu ≡ rồi chọn {icon} Chia sẻ (hoặc nút Chia sẻ trên "
        "thanh địa chỉ).",
        "installed_toast": "Đã cài. Mở chuyến đi từ màn hình chính.",
        "install_menu_open": "Mở menu {icon} của trình duyệt.",
        "install_menu_add": "Chọn Cài đặt ứng dụng hoặc Thêm vào màn hình chính.",
        "install_dock": "Trên thanh menu, chọn Tệp rồi Thêm vào Dock.",
        "install_in_app": "Zalo, Facebook… mở link bằng trình duyệt riêng, "
        "không cài được ứng dụng.",
        "install_in_app_open": "Bấm ••• hoặc ⋮, chọn Mở bằng trình duyệt.",
        "install_in_app_then": "Trong {browser}, bấm Cài ứng dụng lần nữa.",
        "install_copy_hint": "Không thấy mục này? Chép link rồi dán vào {browser}.",
        "install_safari_only": "iOS dưới 16.4 chỉ cài được ứng dụng web bằng Safari. Mở trang này "
        "trong Safari để cài: chép link rồi dán vào Safari.",
        "install_unsupported": "Trình duyệt này chưa cài được ứng dụng web. "
        "Mở trang bằng Chrome hoặc Edge để cài.",
        "install_copy_link": "Chép link",
        "install_copied": "Đã chép link",
        "install_link": "Link chuyến đi",
        "peek_prev": "Điểm dừng trước",
        "peek_next": "Điểm dừng tiếp theo",
        "peek_prev_place": "Địa điểm trước",
        "peek_next_place": "Địa điểm tiếp theo",
        "peek_no_match": "Không có nơi nào khớp",
        "place_1": "{n} địa điểm",
        "my_location": "Vị trí của tôi",
        "locate_finding": "Đang tìm vị trí của bạn…",
        "locate_centre": "Về chỗ bạn đang đứng và đi theo",
        "locate_following": "Bản đồ đang đi theo bạn. Bấm để tắt vị trí",
        "locate_shown": "Đang hiện vị trí của bạn",
        "locate_followed": "Bản đồ đang đi theo bạn",
        "locate_off": "Đã tắt vị trí",
        "locate_blocked": "Vị trí đang bị chặn. Bấm để xem cách bật",
        "locate_retry": "Không tìm được vị trí. Bấm để thử lại",
        "locate_failed": "Không tìm được vị trí của bạn. Thử lại gần cửa sổ hoặc ngoài trời.",
        "locate_blocked_title": "Vị trí đang bị chặn",
        "locate_blocked_why": "Trình duyệt không cho bản đồ dùng vị trí của bạn.",
        "locate_steps_site": "Bấm biểu tượng bên trái địa chỉ trang (ⓘ hoặc ổ khoá) "
        "→ Quyền hoặc Cài đặt trang web → Vị trí → Cho phép.",
        "locate_steps_device": "Vị trí cũng phải được bật cho trình duyệt trong cài đặt của máy.",
        "locate_file": "Mở bản đồ dạng tệp có thể không lấy "
        "được vị trí. Hãy mở link chuyến đi (https).",
        "locate_privacy": "Vị trí chỉ dùng trên máy này, không gửi đi hay lưu lại.",
        "locate_this_browser": "trình duyệt này",
        "locate_ios_app_why": "iPhone chưa cho {app} dùng vị trí, nên trang này không hỏi được "
        "bạn.",
        "locate_refused_why": "Quyền vị trí đã bị từ chối khi trang hỏi.",
        "locate_safari_blocked_why": "Safari đang chặn vị trí cho trang này nên không hỏi được "
        "bạn.",
        "locate_webapp_why": "Ứng dụng trên MH chính có quyền vị trí riêng, tách khỏi trình duyệt.",
        "locate_ios_app_settings": "Mở Cài đặt → Ứng dụng → {app} → Vị trí.",
        "locate_ios_app_settings_old": "Mở Cài đặt → {app} → Vị trí.",
        "locate_ios_while_using": "Chọn Khi dùng ứng dụng và bật Vị trí chính xác.",
        "locate_back_retry": "Quay lại đây, bấm Thử lại (hoặc tải lại trang).",
        "locate_ios_reload_allow": "Tải lại trang, bấm nút vị trí rồi chọn Cho phép khi được hỏi.",
        "locate_safari_websites": "Cài đặt → Quyền riêng tư & Bảo mật → Dịch vụ định vị → Trang "
        "web Safari → Khi dùng ứng dụng, bật Vị trí chính xác.",
        "locate_safari_settings": "Cài đặt → Ứng dụng → Safari → Vị trí → Hỏi hoặc Cho phép.",
        "locate_safari_settings_old": "Cài đặt → Safari → Vị trí → Hỏi hoặc Cho phép.",
        "locate_safari_site": "Trên trang này: bấm aA (hoặc •••) cạnh địa chỉ → Cài đặt trang web "
        "→ Vị trí → Cho phép.",
        "locate_webapp_settings": "Cài đặt → Quyền riêng tư & Bảo mật → Dịch vụ định vị: bật, rồi "
        "chọn ứng dụng này (hoặc Trang web Safari) → Khi dùng ứng dụng.",
        "locate_webapp_readd": "Vẫn bị chặn? Xoá ứng dụng khỏi MH chính, thêm lại, rồi chọn Cho "
        "phép khi được hỏi.",
        "locate_off_title": "Chưa lấy được vị trí",
        "locate_off_why_ios": "iPhone không trả về vị trí: Dịch vụ định vị có thể đang tắt.",
        "locate_off_why": "Thiết bị không trả về vị trí: định vị của máy có thể đang tắt.",
        "locate_ios_services": "Mở Cài đặt → Quyền riêng tư & Bảo mật → Dịch vụ định vị và bật "
        "lên.",
        "locate_ios_services_app": "Ngay bên dưới, chọn {app} → Khi dùng ứng dụng.",
        "locate_ios_services_safari": "Ngay bên dưới, chọn Trang web Safari → Khi dùng ứng dụng.",
        "locate_ios_services_webapp": "Ngay bên dưới, chọn ứng dụng này (hoặc Trang web Safari) → "
        "Khi dùng ứng dụng.",
        "locate_off_device": "Bật Vị trí (GPS) trong cài đặt của máy, rồi bấm Thử lại.",
        "from_you": "{d} từ bạn",
        "max_days": "Lịch trình tối đa 7 ngày",
        "closed_warning": "Đóng cửa ngày này. Giờ mở cửa: {hours}",
        "closing_warning": "Đến lúc {time}, không đủ thời gian trước giờ đóng cửa (cần {need} "
        "phút). Giờ mở cửa: {hours}",
        "past_end_warning": "Rời đi lúc {time}, sau giờ kết thúc ngày {end}",
        "deadline_warning": "Đến lúc {time}, sau hạn {deadline} (hết hàng hoặc đóng sớm)",
        "duplicate_warning": "Được xếp {n} lần; chỉ giữ ở một ngày",
        "unknown_warning": "'{ref}' không phải địa điểm hay điểm lân cận đã biết",
        "unknown_slot_warning": "Khung giờ '{slot}' không có trong nhịp ngày",
        "missing_slot_warning": "Chưa chọn khung giờ",
        "slot_category_warning": "Địa điểm loại {category} trong khung {slot}",
        "slot_order_warning": "{slot} đứng sau một khung giờ muộn hơn",
        "long_leg_warning": "Mất {n} phút di chuyển để đến đây",
        "long_leg_back_warning": "Mất {n} phút để về trung tâm",
        "long_wait_warning": "Chờ {n} phút, bắt đầu lúc {time}",
        "best_time_warning": "Đến lúc {time}, ngoài giờ đẹp nhất {best}",
        "directions_warning": "Kết hợp hướng {a} và {b} (cách nhau {deg}°) trong một ngày",
        "late_return_warning": "Về trung tâm lúc {time}, sau {end}",
        "too_many_days_warning": "Ngày {n} vượt quá trip.days ({days}): tăng trip.days trong "
        "config.yaml hoặc chuyển các điểm dừng này",
        "max_places_warning": "{n} địa điểm, vượt giới hạn {max}",
        "max_nearby_warning": "{n} điểm lân cận, vượt giới hạn {max}",
        "must_unplaced_warning": "Phải đi, nhưng chưa có trong lịch trình",
        "no_errors": "Không có lỗi cần sửa",
        "announce_undone": "Đã hoàn tác",
        "undo_hint": "Hoàn tác bằng Ctrl+Z.",
        "announce_slot": "{name}: {slot}",
        "announce_note": "Đã cập nhật ghi chú cho {name}",
        "announce_times": "Ngày {day} giờ về lúc {end}",
        "announce_day_removed": "Đã xóa ngày {n}. {count} điểm dừng chuyển sang {unplaced}.",
        "announce_reset": "Đã quay về lịch trình gốc",
        "picker_source": "Địa điểm hoặc điểm lân cận",
        "why_first": "Đã là điểm dừng đầu tiên",
        "why_last": "Đã là điểm dừng cuối cùng",
    },
)

LANGUAGES: tuple[Labels, ...] = (EN, VI)


def center_name(labels: Labels, center: Center) -> str:
    """The English label on English sheets when there is one, else the local name."""
    return (center.label_en or center.label) if labels.code == "en" else center.label


def clock(labels: Labels, hhmm: str) -> str:
    """'07:30' as '7:30 AM' (English) or '7:30' (Vietnamese); 24:00 and later wrap."""
    hours, minutes = divmod(to_minutes(hhmm) % DAY_MINUTES, 60)
    if not labels.twelve_hour:
        return f"{hours}:{minutes:02d}"
    suffix = "AM" if hours < 12 else "PM"
    return f"{(hours % 12) or 12}:{minutes:02d} {suffix}"


def clock_range(labels: Labels, start: str, end: str) -> str:
    """'8:12-8:57 AM'; a range past midnight keeps both halves ('10:00 AM-2:00 AM') and ends at
    '24:00' rather than '0:00' on the 24-hour clock (en dashes in the output)."""
    first, last = clock(labels, start), clock(labels, end)
    start_of_day, end_of_day = to_minutes(start) % DAY_MINUTES, to_minutes(end) % DAY_MINUTES
    overnight = end_of_day < start_of_day
    if not labels.twelve_hour and overnight and end_of_day == 0:
        last = "24:00"
    if labels.twelve_hour and not overnight and first[-2:] == last[-2:]:
        first = first[:-3]
    return f"{first}{EN_DASH}{last}"


def localize_times(labels: Labels, text: str) -> str:
    """Rewrite every 'HH:MM' and 'HH:MM-HH:MM' inside free text in the sheet's clock style."""

    def replace(match: re.Match[str]) -> str:
        start, end = match["start"], match["end"]
        if to_minutes(start) > DAY_MINUTES or (end and to_minutes(end) > DAY_MINUTES):
            return match[0]
        return clock_range(labels, start, end) if end else clock(labels, start)

    return TIME_PATTERN.sub(replace, text)


def _is_all_day(period: OpeningPeriod) -> bool:
    return period.open == "00:00" and period.close in (None, "00:00")


def _span(labels: Labels, period: OpeningPeriod) -> str:
    if _is_all_day(period):
        return labels.open_24h
    if period.close is None:
        return labels.open_from.format(time=clock(labels, period.open))
    return clock_range(labels, period.open, period.close)


def day_ranges(labels: Labels, days: Sequence[int]) -> str:
    """[0, 1, 2, 4] as 'Mon-Wed, Fri' (with en dashes)."""
    runs: list[list[int]] = []
    for day in sorted(days):
        if runs and day == runs[-1][-1] + 1:
            runs[-1].append(day)
        else:
            runs.append([day])
    names = labels.weekdays
    return ", ".join(
        names[run[0]] if len(run) == 1 else f"{names[run[0]]}{EN_DASH}{names[run[-1]]}"
        for run in runs
    )


def opening_hours(labels: Labels, hours: Hours | None, *, daily: bool = True) -> str:
    """Short opening hours from periods: '6:30 AM-3:00 PM daily' or 'Mon-Fri ...; closed Sat-Sun'.

    `daily=False` drops the 'daily' word when every day has the same hours.
    """
    if hours is None:
        return ""
    if not hours.periods:
        return "; ".join(localize_times(labels, line) for line in hours.weekday_text)
    by_day: dict[int, list[str]] = {}
    for period in sorted(hours.periods, key=lambda item: (item.day, item.open)):
        by_day.setdefault(period.day, []).append(_span(labels, period))
    groups: dict[tuple[str, ...], list[int]] = {}
    for day, spans in sorted(by_day.items()):
        groups.setdefault(tuple(spans), []).append(day)
    if len(groups) == 1 and len(by_day) == len(labels.weekdays):
        same = ", ".join(next(iter(groups)))
        if same == labels.open_24h:
            return labels.open_24h_daily if daily else same
        return f"{same} {labels.daily}" if daily else same
    parts = [f"{day_ranges(labels, days)} {', '.join(spans)}" for spans, days in groups.items()]
    if closed := sorted(set(range(len(labels.weekdays))) - set(by_day)):
        parts.append(labels.closed_days.format(days=day_ranges(labels, closed)))
    return "; ".join(parts)


def best_time_text(labels: Labels, best_time: BestTime | None, *, prefix: bool = True) -> str:
    """'Best time - 7:30 AM' when best_time.hours exists, else ''."""
    if best_time is None or not best_time.hours:
        return ""
    text = localize_times(labels, best_time.hours)
    if best_time.source == "heuristic":
        text += f" ({labels.heuristic})"
    return f"{labels.best_time} {EN_DASH} {text}" if prefix else text


def best_time_why(labels: Labels, best_time: BestTime | None) -> str:
    """The best time's reason in the sheet's language (English when no Vietnamese one exists)."""
    if best_time is None:
        return ""
    text = (best_time.why_vi if labels.code == "vi" else None) or best_time.why or ""
    return localize_times(labels, text)


def best_with_why(labels: Labels, best_time: BestTime | None) -> str:
    """'6:30-9:00 AM (estimate)' with the reason on a second line."""
    best = best_time_text(labels, best_time, prefix=False)
    why = best_time_why(labels, best_time)
    return "\n".join(part for part in (best, why) if part)


MONTH_PATTERN = re.compile(
    r"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?"
    r"|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b"
)


def localize_calendar(labels: Labels, text: str) -> str:
    """English month names and best-day words in the sheet's language: 'Nov-Apr' -> 'T11-T4'."""
    text = MONTH_PATTERN.sub(lambda match: labels.months[EN_MONTHS.index(match[0][:3])], text)
    return labels.best_days.get(text, text)


def kind_label(labels: Labels, kind: str) -> str:
    """'place_of_worship' as 'Temple / pagoda' / 'Chùa, đền'; unknown kinds stay readable."""
    if kind in labels.kinds:
        return labels.kinds[kind]
    if labels.code == "en":
        return kind.replace("_", " ").capitalize()
    return labels.kinds["attraction"]


def stop_reason(labels: Labels, reason: str | None, reason_vi: str | None) -> str:
    """The planner's note on a stop in the sheet's language (English when no Vietnamese one)."""
    return ((reason_vi if labels.code == "vi" else None) or reason or "").strip()


def unplaced_text(labels: Labels, code: str | None, reason: str | None) -> str:
    """Why a place is out of the plan: the code's label, plus the planner's English note on
    English sheets when it says more than the label; the note alone when there is no known code."""
    reason = (reason or "").strip()
    label = labels.unplaced_codes.get(code or "")
    if label is None:
        return reason
    says_more = reason.casefold() != label.casefold()
    return f"{label} · {reason}" if reason and says_more and labels.code == "en" else label


def tags_text(labels: Labels, tags: Sequence[str]) -> str:
    """Tag chips in the sheet's language: 'breakfast · view'."""
    return " · ".join(labels.tags.get(tag, tag.replace("_", " ")) for tag in tags)


NO_VALUE = "\u2014"


def hours_and_best(labels: Labels, hours: Hours | None, best_time: BestTime | None) -> str:
    """'6:30 AM-3:00 PM (best: 7:00-9:00 AM)'; either half alone when the other is missing."""
    opening = " ".join(opening_hours(labels, hours, daily=False).split())
    best = ""
    if best_time is not None and best_time.hours:
        best = localize_times(labels, best_time.hours)
        if best_time.source == "heuristic":
            best += f", {labels.heuristic}"
    if opening and best:
        return f"{opening} ({labels.best_inline}: {best})"
    if best:
        return f"{labels.best_time}: {best}"
    return opening or NO_VALUE
