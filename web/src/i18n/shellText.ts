/**
 * Strings the export's labels.ui does not ship (yet). labels.ui wins when it has the key; add new
 * app strings here in both languages, then move them to i18n.py map_ui when convenient.
 */
const SHELL_TEXT = {
  en: {
    next: "Next:", skip_to_map: "Skip to map", filters: "Filters", about: "About this map",
    stop_1: "{n} stop", directions_part: "Directions, part {n} of {total}", part_n: "Part {n}",
    new_tab: "(opens in new tab)", hide_from_list: "Hide from my list", show_in_list: "Show in my list again",
    hide_hint: "Only in this browser. Export preferences lists it under removed.",
    from_source: "from {source}", count_hidden: "{shown} of {total} places · {n} hidden",
    show_hidden_places: "Show hidden", hide_hidden_places: "Hide them again",
    open_now: "Open now", closes_at: "closes {time}", closed_now: "Closed now", opens_at: "opens {time}",
    closed_today_note: "Closed today", open_24h: "Open 24 hours", photo_n: "Photo {n} of {name}",
    more_photos: "+{n}", more_photos_label: "Show {n} more photos", offline_badge: "Offline",
    routes_approximate: "Some routes are approximate",
    routes_approximate_failed: "Some routes are approximate (routing service unavailable)",
    prio_chip: "{level}", rating_value: "{rating} ({n})", day_stop: "{day} · #{n}",
    source_comments: "comments", source_caption: "the video caption", source_transcript: "the video",
    source_hours: "opening hours", unplaced_out_of_days: "No room in the days",
    unplaced_too_far: "Too far", unplaced_low_priority: "Lower priority", unplaced_closed: "Closed on trip days",
    unplaced_out_of_window: "Closed at a usable time", unplaced_other: "Other reason",
    loading: "Loading the trip…", load_failed: "The trip could not be loaded.",
    load_missing: "No trip.json next to this page. Run the export: uv run tiktok-trip run --from export",
    retry: "Try again", update_ready: "A new version is ready.", reload: "Reload",
    load_version_newer: "This trip was exported for a newer version of the app. Reload to update it.",
    load_version_older: "This trip was exported by an older version. Reload, or run the export again: uv run tiktok-trip run --from export",
    offline_ready: "Saved for offline use.", install_app: "Install app",
    install_title: "Install this trip", install_why: "It opens from your home screen and works offline.",
    install_confirm: "Install", install_not_now: "Not now", install_got_it: "Got it",
    install_ios_share: "Tap {icon} Share in the browser toolbar (or under •••).",
    install_ios_add: "Choose {icon} Add to Home Screen.", installed_toast: "Installed. Open the trip from your home screen.",
    install_menu_open: "Open the browser menu {icon}.", install_menu_add: "Choose Install app or Add to Home screen.",
    install_dock: "In the menu bar, choose File, then Add to Dock.",
    install_in_app: "Zalo, Facebook and similar apps open links in their own browser, which can't install apps.",
    install_in_app_open: "Tap ••• or ⋮ and choose Open in browser.", install_in_app_then: "In {browser}, tap Install app again.",
    install_copy_hint: "Can't find it? Copy the link and paste it into {browser}.",
    install_safari_only: "On this iOS version only Safari can install apps. Copy the link and open it in Safari.",
    install_unsupported: "This browser can't install web apps. Open this page in Chrome or Edge to install it.",
    install_copy_link: "Copy link", install_copied: "Link copied", install_link: "Trip link",
    peek_prev: "Previous stop", peek_next: "Next stop",
    lightbox_label: "Photos of {name}", photo_prev: "Previous photo", photo_next: "Next photo",
    photo_position: "{n} of {total}", open_video: "Watch the video",
    sheet_peek: "List collapsed", sheet_half: "List at half height", sheet_full: "List at full height",
    sheet_height_half: "half height", sheet_height_full: "full height",
    plan_notes: "Plan notes", plan_problem: "Problem:", plan_note: "Note:",
    plan_problem_1: "1 problem", plan_problems_n: "{n} problems", plan_note_1: "1 note", plan_notes_n: "{n} notes",
  },
  vi: {
    next: "Tiếp theo:", skip_to_map: "Chuyển đến bản đồ", filters: "Bộ lọc", about: "Về bản đồ này",
    stop_1: "{n} điểm dừng", directions_part: "Chỉ đường, phần {n}/{total}", part_n: "Phần {n}",
    new_tab: "(mở trong thẻ mới)", hide_from_list: "Ẩn khỏi danh sách của tôi", show_in_list: "Hiện lại trong danh sách",
    hide_hint: "Chỉ trong trình duyệt này. Xuất preferences sẽ ghi nó vào mục removed.",
    from_source: "từ {source}", count_hidden: "{shown}/{total} địa điểm · {n} đã ẩn",
    show_hidden_places: "Hiện mục đã ẩn", hide_hidden_places: "Ẩn lại",
    open_now: "Đang mở cửa", closes_at: "đóng lúc {time}", closed_now: "Đang đóng cửa", opens_at: "mở lúc {time}",
    closed_today_note: "Hôm nay đóng cửa", open_24h: "Mở cả ngày", photo_n: "Ảnh {n} của {name}",
    more_photos: "+{n}", more_photos_label: "Xem thêm {n} ảnh", offline_badge: "Ngoại tuyến",
    routes_approximate: "Một số tuyến đường chỉ là ước lượng",
    routes_approximate_failed: "Một số tuyến đường chỉ là ước lượng (không tải được đường đi)",
    prio_chip: "Ưu tiên {level}", rating_value: "{rating} ({n})", day_stop: "{day} · #{n}",
    source_comments: "bình luận", source_caption: "chú thích video", source_transcript: "video",
    source_hours: "giờ mở cửa", unplaced_out_of_days: "Hết chỗ trong các ngày",
    unplaced_too_far: "Quá xa", unplaced_low_priority: "Ưu tiên thấp hơn", unplaced_closed: "Đóng cửa vào ngày đi",
    unplaced_out_of_window: "Không mở vào giờ phù hợp", unplaced_other: "Lý do khác",
    loading: "Đang tải chuyến đi…", load_failed: "Không tải được chuyến đi.",
    load_missing: "Không có trip.json cạnh trang này. Chạy bước export: uv run tiktok-trip run --from export",
    retry: "Thử lại", update_ready: "Đã có phiên bản mới.", reload: "Tải lại",
    load_version_newer: "Chuyến đi này được xuất cho phiên bản ứng dụng mới hơn. Tải lại để cập nhật.",
    load_version_older: "Chuyến đi này được xuất bởi phiên bản cũ hơn. Tải lại, hoặc chạy lại bước export: uv run tiktok-trip run --from export",
    offline_ready: "Đã lưu để dùng ngoại tuyến.", install_app: "Cài ứng dụng",
    install_title: "Cài chuyến đi này", install_why: "Mở ngay từ màn hình chính và dùng được khi không có mạng.",
    install_confirm: "Cài đặt", install_not_now: "Để sau", install_got_it: "Đã hiểu",
    install_ios_share: "Bấm {icon} Chia sẻ trên thanh công cụ của trình duyệt (hoặc trong •••).",
    install_ios_add: "Chọn {icon} Thêm vào MH chính.", installed_toast: "Đã cài. Mở chuyến đi từ màn hình chính.",
    install_menu_open: "Mở menu {icon} của trình duyệt.", install_menu_add: "Chọn Cài đặt ứng dụng hoặc Thêm vào màn hình chính.",
    install_dock: "Trên thanh menu, chọn Tệp rồi Thêm vào Dock.",
    install_in_app: "Zalo, Facebook… mở link bằng trình duyệt riêng, không cài được ứng dụng.",
    install_in_app_open: "Bấm ••• hoặc ⋮, chọn Mở bằng trình duyệt.", install_in_app_then: "Trong {browser}, bấm Cài ứng dụng lần nữa.",
    install_copy_hint: "Không thấy mục này? Chép link rồi dán vào {browser}.",
    install_safari_only: "Trên phiên bản iOS này chỉ Safari cài được ứng dụng. Chép link rồi mở bằng Safari.",
    install_unsupported: "Trình duyệt này chưa cài được ứng dụng web. Mở trang bằng Chrome hoặc Edge để cài.",
    install_copy_link: "Chép link", install_copied: "Đã chép link", install_link: "Link chuyến đi",
    peek_prev: "Điểm dừng trước", peek_next: "Điểm dừng tiếp theo",
    lightbox_label: "Ảnh của {name}", photo_prev: "Ảnh trước", photo_next: "Ảnh tiếp theo",
    photo_position: "{n}/{total}", open_video: "Xem video",
    sheet_peek: "Đã thu gọn danh sách", sheet_half: "Danh sách mở một nửa", sheet_full: "Danh sách mở toàn màn hình",
    sheet_height_half: "mở một nửa", sheet_height_full: "mở toàn màn hình",
    plan_notes: "Lưu ý lịch trình", plan_problem: "Vấn đề:", plan_note: "Lưu ý:",
    plan_problem_1: "1 vấn đề", plan_problems_n: "{n} vấn đề", plan_note_1: "1 lưu ý", plan_notes_n: "{n} lưu ý",
  },
} as const satisfies Record<string, Record<string, string>>;

export function shellText(lang: string, key: string): string | undefined {
  const table: Readonly<Record<string, string>> = lang === "vi" ? SHELL_TEXT.vi : SHELL_TEXT.en;
  return table[key] ?? (SHELL_TEXT.en as Readonly<Record<string, string>>)[key];
}

/** First-visit language whatever the browser says; a saved choice wins over it. */
export const DEFAULT_LANG = "vi";

/** DEFAULT_LANG when the trip has it, else the trip's first language. */
export function defaultLang(available: readonly string[]): string {
  return available.includes(DEFAULT_LANG) ? DEFAULT_LANG : (available[0] ?? DEFAULT_LANG);
}
