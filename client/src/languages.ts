/**
 * Map file names and extensions to Monaco Editor supported languages.
 */
export function languageForFile(name: string): string {
  const lowerName = name.toLowerCase()
  if (lowerName === 'dockerfile') return 'dockerfile'
  const extension = lowerName.split('.').pop()
  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript'
    case 'json':
      return 'json'
    case 'css':
    case 'scss':
    case 'less':
      return 'css'
    case 'html':
    case 'htm':
      return 'html'
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'py':
    case 'pyw':
      return 'python'
    case 'rs':
      return 'rust'
    case 'go':
      return 'go'
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell'
    case 'yml':
    case 'yaml':
      return 'yaml'
    case 'sql':
      return 'sql'
    case 'xml':
    case 'svg':
      return 'xml'
    case 'java':
      return 'java'
    case 'c':
    case 'h':
      return 'c'
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
      return 'cpp'
    case 'graphql':
    case 'gql':
      return 'graphql'
    default:
      return 'javascript'
  }
}
