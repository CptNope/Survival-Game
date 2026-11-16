// Device preferences, kept apart from the expedition save so a new game keeps them.
export const SETTINGS_KEY = 'the-wilds-settings-v1';
export const DEFAULT_SETTINGS = Object.freeze({volume: .7, muted: false, sensitivity: 1, view: 'first'});
const VIEWS = ['first', 'third', 'overhead'];

const clamp = (value, low, high, fallback) =>
    Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;

export function normalizeSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        volume: clamp(source.volume, 0, 1, DEFAULT_SETTINGS.volume),
        muted: source.muted === true,
        sensitivity: clamp(source.sensitivity, .3, 2.5, DEFAULT_SETTINGS.sensitivity),
        view: VIEWS.includes(source.view) ? source.view : DEFAULT_SETTINGS.view
    };
}

export function loadSettings(storage) {
    try {
        storage = storage || globalThis.localStorage;
        return normalizeSettings(JSON.parse(storage?.getItem(SETTINGS_KEY) || 'null'));
    } catch { return {...DEFAULT_SETTINGS}; }
}

export function saveSettings(settings, storage) {
    try {
        storage = storage || globalThis.localStorage;
        storage?.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
        return true;
    } catch { return false; }
}
