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
  email: {
    credential: {
      activation: {
        subject: "Set your RentCar password",
        intro: "Hello {name}, an account was created for you ({username}).",
        action: "Set your password with this link. It works once and expires in 24 hours:",
      },
      reset: {
        subject: "Reset your RentCar password",
        intro: "Hello {name}, a password reset was requested for your account ({username}).",
        action: "Choose a new password with this link. It works once and expires in 60 minutes:",
      },
      ignore:
        "If you did not expect this email, you can ignore it. Nothing changes until the link is used.",
    },
  },
} as const;

export type Messages = typeof en;
