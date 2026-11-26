/**
 * Monaco, bundled with the app instead of fetched from a CDN at runtime.
 *
 * `@monaco-editor/react` defaults to loading Monaco from jsDelivr, which
 * breaks under a `script-src 'self'` CSP and makes the editor depend on a
 * third party being up. Configuring the loader with the local `monaco-editor`
 * package and Vite-built web workers keeps everything same-origin.
 *
 * This module is imported lazily from App, so Monaco's weight (several MB)
 * only downloads once someone actually opens a workspace.
 */
import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json':
        return new JsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker()
      case 'typescript':
      case 'javascript':
        return new TsWorker()
      default:
        return new EditorWorker()
    }
  },
}

loader.config({ monaco })

export default Editor
