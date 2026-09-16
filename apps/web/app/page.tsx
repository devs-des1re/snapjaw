import { EditorWorkspace } from "@/components/blocks/editor-workspace";
import { DEFAULT_ACTIVE_FILE, DEFAULT_FILES, DEFAULT_FONT_SIZE } from "@/lib/project";

export default function Page() {
  return (
    <EditorWorkspace
      initialFiles={DEFAULT_FILES}
      initialActiveFile={DEFAULT_ACTIVE_FILE}
      initialFontSize={DEFAULT_FONT_SIZE}
    />
  );
}
