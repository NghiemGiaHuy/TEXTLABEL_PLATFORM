import { Check, X } from 'lucide-react';
import type {
  EditableAIRelationSuggestion,
  LabelOption,
} from '../types';

interface EntityOption {
  id: string;
  text: string;
  label: string;
}

interface Props {
  suggestions: EditableAIRelationSuggestion[];
  entities: EntityOption[];
  labels: LabelOption[];
  loading: boolean;
  disabled: boolean;
  onSuggest: () => void;
  onChange: (
    id: string,
    patch: Partial<EditableAIRelationSuggestion>
  ) => void;
  onToggleAccept: (id: string) => void;
  onReject: (id: string) => void;
  onAddAccepted: () => void;
}

export default function AIRelationSuggestionsPanel({
  suggestions,
  entities,
  labels,
  loading,
  disabled,
  onSuggest,
  onChange,
  onToggleAccept,
  onReject,
  onAddAccepted,
}: Props) {
  const acceptedCount = suggestions.filter((suggestion) => suggestion.accepted).length;

  return (
    <div className="space-y-2">
      <div className="flex justify-center">
        <button
          onClick={onSuggest}
          disabled={disabled || loading || entities.length < 2 || labels.length === 0}
          className="shrink-0 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-white text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? 'Đang gợi ý...' : 'Suggest by AI'}
        </button>
      </div>

      {suggestions.map((suggestion) => (
        <div
          key={suggestion.id}
          className={`rounded-lg border p-2 ${
            suggestion.accepted ? 'border-emerald-300 bg-emerald-50' : 'border-indigo-100 bg-white'
          }`}
        >
          <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-500 mb-1.5">
            Gemini {Math.round(suggestion.confidence * 100)}%
          </p>
          <div className="space-y-1.5">
            <select
              value={suggestion.head_id}
              onChange={(event) => onChange(suggestion.id, { head_id: event.target.value })}
              disabled={disabled}
              className="w-full rounded-md border border-surface-200 bg-white px-2 py-1 text-xs text-surface-700"
            >
              {entities.map((entity) => <option key={entity.id} value={entity.id}>HEAD: {entity.text}</option>)}
            </select>
            <select
              value={suggestion.tail_id}
              onChange={(event) => onChange(suggestion.id, { tail_id: event.target.value })}
              disabled={disabled}
              className="w-full rounded-md border border-surface-200 bg-white px-2 py-1 text-xs text-surface-700"
            >
              {entities.map((entity) => <option key={entity.id} value={entity.id}>TAIL: {entity.text}</option>)}
            </select>
            <select
              value={suggestion.relation}
              onChange={(event) => onChange(suggestion.id, { relation: event.target.value })}
              disabled={disabled}
              className="w-full rounded-md border border-surface-200 bg-white px-2 py-1 text-xs text-surface-700"
            >
              {labels.map((label) => <option key={label.id} value={label.name}>{label.name}</option>)}
            </select>
          </div>
          <div className="flex items-center justify-end gap-1.5 mt-2">
            <button
              onClick={() => onToggleAccept(suggestion.id)}
              disabled={disabled}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-100 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-200 disabled:opacity-40"
            >
              <Check className="w-3 h-3" />
              {suggestion.accepted ? 'Bỏ chọn' : 'Chấp nhận'}
            </button>
            <button
              onClick={() => onReject(suggestion.id)}
              disabled={disabled}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-red-50 text-[11px] font-semibold text-red-600 hover:bg-red-100 disabled:opacity-40"
            >
              <X className="w-3 h-3" />
              Từ chối
            </button>
          </div>
        </div>
      ))}

      {suggestions.length > 0 && (
        <button
          onClick={onAddAccepted}
          disabled={disabled || acceptedCount === 0}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Check className="w-3.5 h-3.5" />
          Đưa {acceptedCount} gợi ý vào bản nháp
        </button>
      )}
    </div>
  );
}
