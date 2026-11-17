import { Platform } from 'react-native'

/** What the app calls the device it runs on, in sentences like "Notes on this iPhone stay here." */
export const device = Platform.OS === 'ios' ? 'iPhone' : 'phone'
