// Fixture: must be reported by domain-only-shared-and-self (imports platform).
import { loadConfig } from "../../../platform/config";

export const price = (): unknown => loadConfig;
