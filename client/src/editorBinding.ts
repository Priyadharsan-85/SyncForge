import type { editor } from 'monaco-editor'
import type * as Y from 'yjs'

export function bindYTextToMonaco(
  text: Y.Text,
  editorInstance: editor.IStandaloneCodeEditor,
): () => void {
  const model = editorInstance.getModel()
  if (!model) return () => {}
  if (model.getValue() !== text.toString()) model.setValue(text.toString())

  const onMonacoChange = (event: editor.IModelContentChangedEvent) => {
    const doc = text.doc
    if (!doc) return

    doc.transact(() => {
      for (const change of [...event.changes].sort((a, b) => b.rangeOffset - a.rangeOffset)) {
        if (change.rangeLength > 0) text.delete(change.rangeOffset, change.rangeLength)
        if (change.text.length > 0) text.insert(change.rangeOffset, change.text)
      }
    }, editorInstance)
  }

  const onYTextChange = (event: Y.YTextEvent) => {
    if (event.transaction.origin === editorInstance || model.isDisposed()) return

    let index = 0
    let editStart = 0
    let deleteLength = 0
    let insertedText = ''
    const edits: Array<{ offset: number; edit: editor.IIdentifiedSingleEditOperation }> = []

    const flush = () => {
      if (deleteLength === 0 && insertedText.length === 0) return
      const start = model.getPositionAt(editStart)
      const end = model.getPositionAt(editStart + deleteLength)
      edits.push({
        offset: editStart,
        edit: {
          range: {
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
          },
          text: insertedText,
          forceMoveMarkers: true,
        },
      })
      deleteLength = 0
      insertedText = ''
    }

    for (const operation of event.delta) {
      if (operation.retain !== undefined) {
        flush()
        index += operation.retain
      } else if (operation.delete !== undefined) {
        if (deleteLength === 0 && insertedText.length === 0) editStart = index
        deleteLength += operation.delete
      } else if (typeof operation.insert === 'string') {
        if (deleteLength === 0 && insertedText.length === 0) editStart = index
        insertedText += operation.insert
      }
    }
    flush()

    edits.sort((a, b) => b.offset - a.offset)
    if (edits.length > 0) editorInstance.executeEdits('syncforge-remote', edits.map(({ edit }) => edit))
  }

  const monacoListener = editorInstance.onDidChangeModelContent(onMonacoChange)
  text.observe(onYTextChange)

  return () => {
    monacoListener.dispose()
    text.unobserve(onYTextChange)
  }
}
