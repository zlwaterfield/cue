const m = new Map()
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 0
export const getItem = (k) => m.get(k) ?? null
export const setItem = (k, v) => void m.set(k, v)
export const deleteItemAsync = async (k) => void m.delete(k)
