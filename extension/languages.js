export const OUTPUT_LANGUAGES = ["English", "French", "Dutch", "German", "Spanish", "Italian", "Portuguese", "Arabic", "Chinese", "Hindi", "Japanese", "Korean", "Polish", "Russian", "Swedish", "Turkish", "Ukrainian"];
export function captionTrackKey(track) { return `${track.languageCode}:${track.kind || "manual"}`; }
export function fillCaptionOptions(select, tracks = [], selected = "auto", documentOwner = select.ownerDocument || globalThis.document) {
  select.replaceChildren();
  const option = (value, text) => {
    const element = documentOwner.createElement("option"); element.value = value; element.textContent = text; select.appendChild(element);
  };
  option("auto", "Best available");
  for (const track of tracks) option(captionTrackKey(track), `${track.name || track.languageCode}${track.kind === "asr" ? " · automatic" : ""}`);
  if (selected !== "auto" && !tracks.some(track => captionTrackKey(track) === selected)) option(selected, `${selected.split(":")[0]} · unavailable on this video`);
  select.value = selected;
}
