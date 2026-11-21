export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 128

export function passwordPolicyMessage(password: string, username = '') {
  const value = String(password || '')
  if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) {
    return 'Password must be 10 to 128 characters.'
  }
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Password must include a letter and a number.'
  }
  if (username.trim() && value.trim().toLowerCase() === username.trim().toLowerCase()) {
    return 'Password cannot match the username.'
  }
  return ''
}
