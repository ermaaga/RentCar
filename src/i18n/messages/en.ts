// Message catalog (single locale `en`). Keys are English identifiers `module.area.name` (03b section 13).
export const en = {
  app: {
    name: "RentCar",
    description: "Car rental management",
  },
  home: {
    title: "RentCar",
    status: "Foundations milestone (M0). The application is not available yet.",
  },
} as const;

export type Messages = typeof en;
