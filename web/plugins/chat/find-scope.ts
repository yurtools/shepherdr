import { createContext, useContext } from 'react'

// A search belongs to the mounted ChatView, not a global DOM query or a
// message ID that may be shared by a companion or another Feature.
export const FindQuery = createContext('')
export const FindActive = createContext<string | null>(null)
export const useFindQuery = () => useContext(FindQuery)
