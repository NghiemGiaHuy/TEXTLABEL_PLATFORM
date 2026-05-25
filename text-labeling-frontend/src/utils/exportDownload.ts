import type { ExportDownloadData } from '../api/projectApi';

type ExportFormat = ExportDownloadData['export_info']['format'];
type ExportItem = ExportDownloadData['data'][number];

type PublicExportItem = Pick<ExportItem, 'sample_id' | 'content' | 'annotations'>;

function toPublicExportItem(item: ExportItem): PublicExportItem {
  return {
    sample_id: item.sample_id,
    content: item.content,
    annotations: item.annotations,
  };
}

function csvValue(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function buildExportFile(format: ExportFormat, items: ExportItem[]) {
  const publicItems = items.map(toPublicExportItem);

  if (format === 'csv') {
    const headers = ['sample_id', 'content', 'annotations'];
    const rows = publicItems.map((item) =>
      [
        item.sample_id,
        item.content ?? '',
        JSON.stringify(item.annotations),
      ].map(csvValue).join(',')
    );

    return {
      content: [headers.join(','), ...rows].join('\n'),
      mimeType: 'text/csv;charset=utf-8',
      extension: 'csv',
    };
  }

  if (format === 'jsonl') {
    return {
      content: publicItems.map((item) => JSON.stringify(item)).join('\n'),
      mimeType: 'application/x-ndjson',
      extension: 'jsonl',
    };
  }

  return {
    content: JSON.stringify(publicItems, null, 2),
    mimeType: 'application/json',
    extension: 'json',
  };
}

export function downloadExportFile(downloadData: ExportDownloadData, filenameBase: string) {
  const { content, mimeType, extension } = buildExportFile(
    downloadData.export_info.format,
    downloadData.data
  );
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = `${filenameBase}.${extension}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
