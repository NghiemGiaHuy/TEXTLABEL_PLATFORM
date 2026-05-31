import { Check, Loader2, Save, X } from 'lucide-react';
import type {
  EditableAIWorkspaceSuggestion,
  LabelOption,
} from '../types';

interface Props {
  suggestions: EditableAIWorkspaceSuggestion[];
  labels: LabelOption[];
  sourceText: string;
  loading: boolean;
  saving: boolean;
  disabled: boolean;
  onSuggest: () => void;
  onChange: (
    id: string,
    patch: Partial<EditableAIWorkspaceSuggestion>
  ) => void;
  onToggleAccept: (id: string) => void;
  onReject: (id: string) => void;
  onSave: () => void;
}

export default function AISuggestionsPanel({
  suggestions,
  labels,
  sourceText,
  loading,
  saving,
  disabled,
  onSuggest,
  onChange,
  onToggleAccept,
  onReject,
  onSave,
}: Props) {
  const acceptedCount = suggestions.filter((suggestion) => suggestion.accepted).length;

  return (
    <div>
      <div className="px-4 py-3 flex justify-end">
        <button
          onClick={onSuggest}
          disabled={disabled || loading}
          className="shrink-0 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-white text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? 'Đang gợi ý...' : 'Suggest by AI'}
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="px-4 pb-3 space-y-2">
          {suggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className={`rounded-xl border p-2.5 ${
                suggestion.accepted
                  ? 'border-emerald-300 bg-emerald-50'
                  : 'border-indigo-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">
                  Gemini {Math.round(suggestion.confidence * 100)}%
                </span>
                {suggestion.accepted && (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">
                    Đã chấp nhận
                  </span>
                )}
              </div>

              <select
                value={suggestion.label}
                onChange={(event) => onChange(suggestion.id, { label: event.target.value })}
                disabled={disabled || saving}
                className="w-full rounded-lg border border-surface-200 bg-white px-2 py-1.5 text-xs font-medium text-surface-700 outline-none"
              >
                {labels.map((label) => (
                  <option key={label.id} value={label.name}>{label.name}</option>
                ))}
              </select>

              {suggestion.task_type === 'ner' && (
                <>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <label className="text-[10px] font-semibold text-surface-500">
                      START
                      <input
                        type="number"
                        min={0}
                        max={sourceText.length}
                        value={suggestion.start}
                        onChange={(event) => {
                          const start = Number(event.target.value);
                          onChange(suggestion.id, {
                            start,
                            text: sourceText.slice(start, suggestion.end),
                          });
                        }}
                        disabled={disabled || saving}
                        className="mt-1 w-full rounded-lg border border-surface-200 bg-white px-2 py-1.5 text-xs font-medium text-surface-700 outline-none"
                      />
                    </label>
                    <label className="text-[10px] font-semibold text-surface-500">
                      END
                      <input
                        type="number"
                        min={0}
                        max={sourceText.length}
                        value={suggestion.end}
                        onChange={(event) => {
                          const end = Number(event.target.value);
                          onChange(suggestion.id, {
                            end,
                            text: sourceText.slice(suggestion.start, end),
                          });
                        }}
                        disabled={disabled || saving}
                        className="mt-1 w-full rounded-lg border border-surface-200 bg-white px-2 py-1.5 text-xs font-medium text-surface-700 outline-none"
                      />
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-surface-600 break-words">"{suggestion.text}"</p>
                </>
              )}

              <div className="flex items-center justify-end gap-1.5 mt-2">
                <button
                  onClick={() => onToggleAccept(suggestion.id)}
                  disabled={disabled || saving}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-100 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-200 disabled:opacity-40"
                >
                  <Check className="w-3 h-3" />
                  {suggestion.accepted ? 'Bỏ chọn' : 'Chấp nhận'}
                </button>
                <button
                  onClick={() => onReject(suggestion.id)}
                  disabled={disabled || saving}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-red-50 text-[11px] font-semibold text-red-600 hover:bg-red-100 disabled:opacity-40"
                >
                  <X className="w-3 h-3" />
                  Từ chối
                </button>
              </div>
            </div>
          ))}

          <button
            onClick={onSave}
            disabled={acceptedCount === 0 || disabled || saving}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Lưu {acceptedCount} gợi ý đã chấp nhận
          </button>
        </div>
      )}
    </div>
  );
}
