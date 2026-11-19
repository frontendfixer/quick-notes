import pdfMake from 'pdfmake/build/pdfmake'
import courier from 'pdfmake/build/standard-fonts/Courier'
import fonts from 'pdfmake/build/vfs_fonts'
import type { Content, ContentText, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces'
import { noteImage, noteLink, type DocumentNode } from '../../../packages/contracts'

pdfMake.addVirtualFileSystem(fonts)
pdfMake.addFontContainer(courier)

function inlineText(node: DocumentNode): ContentText {
  if (node.type === 'hardBreak') return { text: '\n' }

  const marks = new Set(node.marks?.map(({ type }) => type))
  const link = noteLink.safeParse(node.marks?.find(({ type }) => type === 'link')?.attrs?.href)
  const decoration: ('underline' | 'lineThrough')[] = []
  if (marks.has('underline') || link.success) decoration.push('underline')
  if (marks.has('strike')) decoration.push('lineThrough')

  return {
    text: node.text ?? '',
    bold: marks.has('bold') || undefined,
    italics: marks.has('italic') || undefined,
    font: marks.has('code') ? 'Courier' : undefined,
    background: marks.has('highlight') ? '#fff0a8' : marks.has('code') ? '#f1f3f5' : undefined,
    decoration,
    link: link.success ? link.data : undefined,
    color: link.success ? '#1d4e89' : undefined,
  }
}

async function pdfImage(node: DocumentNode): Promise<Content> {
  const url = noteImage.safeParse(node.attrs?.src)
  const alt = String(node.attrs?.alt || 'Image')
  if (!url.success) return { text: alt, italics: true }

  try {
    const response = await fetch(url.data, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error('Image unavailable')
    const bitmap = await createImageBitmap(await response.blob())
    try {
      const scale = Math.min(1, 1200 / bitmap.width, 900 / bitmap.height)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Image rendering unavailable')
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      return {
        image: canvas.toDataURL('image/png'),
        fit: [Math.min(canvas.width * 0.75, 360), 300],
        link: url.data,
        margin: [0, 4, 0, 4],
      }
    } finally {
      bitmap.close()
    }
  } catch {
    return { text: alt, link: url.data, color: '#1d4e89', decoration: 'underline' }
  }
}

async function pdfParagraph(node: DocumentNode): Promise<Content> {
  const items: Content[] = []
  let text: ContentText[] = []
  for (const child of node.content ?? []) {
    if (child.type === 'image') {
      if (text.length) items.push({ text })
      text = []
      items.push(await pdfImage(child))
    } else {
      text.push(inlineText(child))
    }
  }
  if (text.length || !items.length) items.push({ text: text.length ? text : ' ' })
  return {
    stack: items,
    style: node.type === 'heading' ? 'heading' : 'paragraph',
    fontSize: node.type === 'heading' ? 22 - 2 * Number(node.attrs?.level ?? 1) : undefined,
  }
}

async function pdfBlock(node: DocumentNode): Promise<Content> {
  const children = node.content ?? []
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return pdfParagraph(node)
    case 'blockquote':
      return {
        stack: await Promise.all(children.map(pdfBlock)),
        margin: [16, 0, 0, 6],
        italics: true,
      }
    case 'codeBlock':
      return { text: children.map((child) => child.text).join('') || ' ', style: 'code' }
    case 'horizontalRule':
      return {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: 490, y2: 0, lineColor: '#b9b9b9' }],
        margin: [0, 8, 0, 12],
      }
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const items = await Promise.all(
        children.map(async (item) => ({
          stack: await Promise.all((item.content ?? []).map(pdfBlock)),
        })),
      )
      if (node.type === 'orderedList') return { ol: items, start: Number(node.attrs?.start ?? 1) }
      if (node.type === 'taskList') {
        return {
          stack: items.map((item, index) => ({
            columns: [
              { text: children[index].attrs?.checked ? '[x]' : '[ ]', width: 24 },
              { ...item, width: '*' },
            ],
          })),
        }
      }
      return { ul: items }
    }
    case 'table': {
      const width = Math.max(1, ...children.map((row) => row.content?.length ?? 0))
      const body = await Promise.all(
        children.map(async (row) => {
          const cells = await Promise.all(
            (row.content ?? []).map(async (cell): Promise<TableCell> => ({
              stack: await Promise.all((cell.content ?? []).map(pdfBlock)),
              bold: cell.type === 'tableHeader',
              alignment:
                cell.attrs?.align === 'right' || cell.attrs?.align === 'center'
                  ? cell.attrs.align
                  : ('left' as const),
            })),
          )
          return [...cells, ...Array<string>(width - cells.length).fill('')]
        }),
      )
      return {
        table: {
          widths: Array<'*'>(width).fill('*'),
          headerRows: children[0]?.content?.every((cell) => cell.type === 'tableHeader') ? 1 : 0,
          body,
        },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 10],
      }
    }
    default:
      return { stack: await Promise.all(children.map(pdfBlock)) }
  }
}

export async function exportNotePdf(title: string, document: DocumentNode, printWindow?: Window) {
  const definition: TDocumentDefinitions = {
    info: { title },
    pageSize: 'A4',
    pageMargins: [48, 48, 48, 48],
    defaultStyle: { fontSize: 11, lineHeight: 1.2 },
    styles: {
      title: { fontSize: 26, bold: true, margin: [0, 0, 0, 16] },
      heading: { bold: true, margin: [0, 8, 0, 6] },
      paragraph: { margin: [0, 0, 0, 6] },
      code: { font: 'Courier', fontSize: 9, margin: [8, 4, 0, 12] },
    },
    content: [
      { text: title, style: 'title' },
      ...(await Promise.all((document.content ?? []).map(pdfBlock))),
    ],
  }
  const pdf = pdfMake.createPdf(definition)
  if (printWindow) await pdf.print(printWindow)
  else {
    const name = title
      .replace(/[^\p{L}\p{N} ._-]/gu, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 120)
    await pdf.download(`${name || 'Untitled'}.pdf`)
  }
}
