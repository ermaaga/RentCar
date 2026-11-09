export {
  FUEL_TYPES,
  parsePriceToMinor,
  VEHICLE_CATEGORIES,
  vehicleInput,
} from "./application/vehicle-input";
export {
  createVehicle,
  getVehicle,
  listVehicles,
  removeVehicle,
  setMaintenance,
  updateVehicle,
  vehicleUsage,
} from "./infrastructure/vehicles";
export type { VehicleRow } from "./infrastructure/vehicles";
