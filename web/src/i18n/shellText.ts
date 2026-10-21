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
    install_ios: "To install: Share, then Add to Home Screen.",
    lightbox_label: "Photos of {name}", photo_prev: "Previous photo", photo_next: "Next photo",
    photo_position: "{n} of {total}", open_video: "Watch the video",
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
    install_ios: "Để cài: bấm Chia sẻ, rồi Thêm vào MH chính.",
    lightbox_label: "Ảnh của {name}", photo_prev: "Ảnh trước", photo_next: "Ảnh tiếp theo",
    photo_position: "{n}/{total}", open_video: "Xem video",
  },
} as const satisfies Record<string, Record<string, string>>;

export function shellText(lang: string, key: string): string | undefined {
  const table: Readonly<Record<string, string>> = lang === "vi" ? SHELL_TEXT.vi : SHELL_TEXT.en;
  return table[key] ?? (SHELL_TEXT.en as Readonly<Record<string, string>>)[key];
}

/** The browser's language when the trip has it, else English. */
export function browserLang(available: readonly string[], language: string = navigator.language): string {
  const code = (language || "en").toLowerCase().startsWith("vi") ? "vi" : "en";
  return available.includes(code) ? code : (available[0] ?? "en");
}
