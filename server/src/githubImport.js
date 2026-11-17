const MAX_FILES = 300
const MAX_FILE_BYTES = 512 * 1024
const MAX_TOTAL_BYTES = 6 * 1024 * 1024
const MAX_CONTRIBUTORS = 1_000
const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
])
const BINARY_EXTENSIONS = new Set([
  '.7z',
  '.avi',
  '.bmp',
  '.class',
  '.db',
  '.dll',
  '.dylib',
  '.eot',
  '.exe',
  '.gif',
  '.gz',
  '.ico',
  '.jar',
  '.jpeg',
  '.jpg',
  '.mov',
  '.mp3',
  '.mp4',
  '.otf',
  '.pdf',
  '.png',
  '.so',
  '.sqlite',
  '.tar',
  '.tif',
  '.tiff',
  '.ttf',
  '.wasm',
  '.wav',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
  '.zip',
])
const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'SyncForge',
  'X-GitHub-Api-Version': '2022-11-28',
}

export class GitHubImportError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

export function parsePublicRepositoryUrl(value) {
  if (typeof value !== 'string' || value.length > 500) {
    throw new GitHubImportError('Enter a valid public GitHub repository URL.')
  }
  let url
  try {
    url = new URL(value)
  } catch {
    throw new GitHubImportError('Enter a valid public GitHub repository URL.')
  }
  const [owner, rawRepository, ...extraPath] = url.pathname.split('/').filter(Boolean)
  const repository = rawRepository?.replace(/\.git$/i, '')
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    extraPath.length ||
    !owner ||
    !repository ||
    !/^[A-Za-z0-9_.-]+$/.test(owner) ||
    !/^[A-Za-z0-9_.-]+$/.test(repository)
  ) {
    throw new GitHubImportError('Use a repository URL like https://github.com/owner/repository.')
  }
  return { owner, repository }
}

async function fetchGitHubJson(url, fetchImplementation) {
  let response
  try {
    response = await fetchImplementation(url, {
      headers: GITHUB_HEADERS,
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    throw new GitHubImportError(`Could not reach GitHub: ${error.message}`, 502)
  }
  if (!response.ok) {
    const message = response.status === 403
      ? 'GitHub rate limit reached. Wait a little and try again.'
      : response.status === 404
        ? 'Repository not found or it is not public.'
        : `GitHub could not load the repository (HTTP ${response.status}).`
    throw new GitHubImportError(message, response.status === 403 ? 429 : 502)
  }
  try {
    return await response.json()
  } catch {
    throw new GitHubImportError('GitHub returned an invalid response.', 502)
  }
}

function isImportableTreeEntry(entry) {
  if (
    entry.type !== 'blob' ||
    entry.mode === '120000' ||
    !Number.isSafeInteger(entry.size) ||
    entry.size < 0 ||
    entry.size > MAX_FILE_BYTES ||
    typeof entry.path !== 'string' ||
    entry.path.length > 512 ||
    entry.path.startsWith('/') ||
    entry.path.includes('\\')
  ) return false

  const segments = entry.path.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || IGNORED_DIRECTORIES.has(segment))) {
    return false
  }
  const extension = entry.path.match(/\.[^./]+$/)?.[0].toLowerCase()
  return !extension || !BINARY_EXTENSIONS.has(extension)
}

async function readContributors(owner, repository, fetchImplementation) {
  const contributors = new Map()
  for (let page = 1; page <= MAX_CONTRIBUTORS / 100; page += 1) {
    const query = new URLSearchParams({ per_page: '100', page: String(page) })
    const response = await fetchGitHubJson(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contributors?${query}`,
      fetchImplementation,
    )
    if (!Array.isArray(response)) {
      throw new GitHubImportError('GitHub returned an invalid contributor list.', 502)
    }
    for (const contributor of response) {
      if (
        (typeof contributor.id === 'number' || typeof contributor.id === 'string') &&
        typeof contributor.login === 'string' &&
        contributor.type !== 'Bot'
      ) {
        const id = String(contributor.id)
        contributors.set(id, {
          id,
          login: contributor.login.slice(0, 39),
          name: contributor.login.slice(0, 32),
        })
      }
    }
    if (response.length < 100) return [...contributors.values()]
  }
  throw new GitHubImportError(
    `Repositories with more than ${MAX_CONTRIBUTORS} contributors are not supported yet.`,
  )
}

async function fetchRawFile(owner, repository, commitSha, entry, fetchImplementation) {
  const path = entry.path.split('/').map(encodeURIComponent).join('/')
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${commitSha}/${path}`
  let response
  try {
    response = await fetchImplementation(url, {
      headers: { 'User-Agent': 'SyncForge' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    throw new GitHubImportError(`Could not download ${entry.path}: ${error.message}`, 502)
  }
  if (!response.ok) {
    throw new GitHubImportError(`Could not download ${entry.path} from GitHub.`, 502)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length > MAX_FILE_BYTES) return null
  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (content.includes('\0')) return null
    return { path: entry.path, content }
  } catch {
    return null
  }
}

async function mapConcurrent(items, concurrency, callback) {
  const results = new Array(items.length)
  let nextIndex = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await callback(items[index])
    }
  }))
  return results
}

export async function importPublicGitHubRepository(repositoryUrl, fetchImplementation = fetch) {
  const { owner, repository } = parsePublicRepositoryUrl(repositoryUrl)
  const baseUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
  const repo = await fetchGitHubJson(baseUrl, fetchImplementation)
  if (repo.private) throw new GitHubImportError('Only public GitHub repositories can be imported.')
  if (typeof repo.default_branch !== 'string' || typeof repo.full_name !== 'string') {
    throw new GitHubImportError('GitHub returned incomplete repository details.', 502)
  }

  const [commit, tree, contributors] = await Promise.all([
    fetchGitHubJson(
      `${baseUrl}/commits/${encodeURIComponent(repo.default_branch)}`,
      fetchImplementation,
    ),
    fetchGitHubJson(
      `${baseUrl}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`,
      fetchImplementation,
    ),
    readContributors(owner, repository, fetchImplementation),
  ])
  if (
    typeof commit.sha !== 'string' ||
    !/^[a-f0-9]{40}$/i.test(commit.sha) ||
    !Array.isArray(tree.tree) ||
    tree.truncated
  ) {
    throw new GitHubImportError('The repository tree is too large or could not be read.')
  }

  const entries = tree.tree.filter(isImportableTreeEntry)
  if (entries.length > MAX_FILES) {
    throw new GitHubImportError(`Repositories with more than ${MAX_FILES} importable files are not supported yet.`)
  }
  if (entries.reduce((sum, entry) => sum + entry.size, 0) > MAX_TOTAL_BYTES) {
    throw new GitHubImportError('The repository has more than 6 MiB of importable text files.')
  }
  const files = (await mapConcurrent(entries, 5, (entry) =>
    fetchRawFile(owner, repository, commit.sha, entry, fetchImplementation),
  )).filter(Boolean)
  const totalBytes = files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0)
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new GitHubImportError('The repository has more than 6 MiB of importable text files.')
  }
  if (files.length === 0) {
    throw new GitHubImportError('No supported text files were found in this repository.')
  }

  return {
    name: repo.full_name,
    source: {
      type: 'github',
      repository: repo.full_name,
      url: `https://github.com/${owner}/${repository}`,
      defaultBranch: repo.default_branch,
    },
    contributors,
    files,
  }
}
