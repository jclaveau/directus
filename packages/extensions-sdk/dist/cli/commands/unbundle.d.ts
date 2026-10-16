/**
 * Writes the original sources a bundle's map carries back out as a directory tree. A
 * built extension ships without them, so the map is the only place left to read what
 * a stack trace points at — or to patch a single module of a deployed extension.
 */
export default function unbundle(bundle: string, directory: string): Promise<void>;
