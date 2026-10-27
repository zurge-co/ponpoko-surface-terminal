export const SURFACE_BRIDGE_VERBS = ["tool.file", "backend.call"] as const;

export const SURFACE_DOORS = SURFACE_BRIDGE_VERBS;

export type SurfaceBridgeVerb = (typeof SURFACE_BRIDGE_VERBS)[number];
