import { useSearchParams } from "react-router-dom";
import {
  DEFAULT_ANALYZE_MODEL_ALIAS,
  isAnalyzeModelAlias,
  type AnalyzeModelAlias,
} from "@shared/types";
import { SessionAnalysisPanel } from "../../components/SessionAnalysisPanel";
import { useSessionWorkspace } from "../SessionWorkspace";

/**
 * `?model=` is the only state this tab owns. An unrecognised value falls back
 * to the default rather than reaching the API, and picking a model replaces the
 * URL so the back button leaves the tab instead of walking model choices.
 */
export function AnalysisView() {
  const { detail } = useSessionWorkspace();
  const [search, setSearch] = useSearchParams();

  const raw = search.get("model");
  const model: AnalyzeModelAlias =
    raw && isAnalyzeModelAlias(raw) ? raw : DEFAULT_ANALYZE_MODEL_ALIAS;

  const setModel = (next: AnalyzeModelAlias) => {
    const params = new URLSearchParams(search);
    params.set("model", next);
    setSearch(params, { replace: true });
  };

  return (
    <SessionAnalysisPanel
      sessionId={detail.meta.id}
      model={model}
      onModelChange={setModel}
    />
  );
}
