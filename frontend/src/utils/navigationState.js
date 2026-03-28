const POST_AUTH_PATH_KEY = 'padiguard_post_auth_path'
const LAST_APP_PATH_KEY = 'padiguard_last_app_path'

export function setPostAuthPath(path) {
  if (!path || !path.startsWith('/')) {
    return
  }

  localStorage.setItem(POST_AUTH_PATH_KEY, path)
}

export function getPostAuthPath() {
  const path = localStorage.getItem(POST_AUTH_PATH_KEY)
  if (!path || !path.startsWith('/')) {
    return null
  }

  return path
}

export function clearPostAuthPath() {
  localStorage.removeItem(POST_AUTH_PATH_KEY)
}

export function setLastAppPath(path) {
  if (!path || !path.startsWith('/app')) {
    return
  }

  localStorage.setItem(LAST_APP_PATH_KEY, path)
}

export function getLastAppPath() {
  const path = localStorage.getItem(LAST_APP_PATH_KEY)
  if (!path || !path.startsWith('/app')) {
    return '/app'
  }

  return path
}
