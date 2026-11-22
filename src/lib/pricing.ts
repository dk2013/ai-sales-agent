// Business rules live in code, not in the prompt: the model asks for a quote, the code does the math.
// Prices come from the RouteWise product FAQ (fictional product).
export type Plan = "Starter" | "Growth" | "Enterprise";

const PER_VEHICLE: Record<Exclude<Plan, "Enterprise">, number> = { Starter: 49, Growth: 79 };
const ANNUAL_DISCOUNT = 0.15;
const NONPROFIT_DISCOUNT = 0.2;

export function planForFleet(vehicles: number): Plan {
  if (vehicles <= 10) return "Starter";
  if (vehicles <= 100) return "Growth";
  return "Enterprise";
}

export interface Quote {
  plan: Plan;
  vehicles: number;
  pricePerVehicle: number | null;
  monthly: number | null; // per month, after discounts
  annualTotal: number | null; // only when annual billing is requested
  discounts: string[];
  notes: string[];
}

const round = (n: number) => Math.round(n * 100) / 100;

export function quote(vehicles: number, opts: { annual?: boolean; nonprofit?: boolean } = {}): Quote {
  const plan = planForFleet(vehicles);
  const notes = ["Every plan starts with a 14-day free trial (up to 5 vehicles, no credit card)."];
  if (plan === "Enterprise") {
    return {
      plan, vehicles, pricePerVehicle: null, monthly: null, annualTotal: null, discounts: [],
      notes: [...notes, "Enterprise pricing is custom: SSO, dedicated success manager, 99.95% uptime SLA."],
    };
  }
  let perVehicle = PER_VEHICLE[plan];
  const discounts: string[] = [];
  if (opts.annual) {
    perVehicle *= 1 - ANNUAL_DISCOUNT;
    discounts.push("15% annual billing discount");
  }
  if (opts.nonprofit) {
    perVehicle *= 1 - NONPROFIT_DISCOUNT;
    discounts.push("20% non-profit discount");
  }
  const monthly = round(perVehicle * vehicles);
  return {
    plan, vehicles, pricePerVehicle: round(perVehicle), monthly,
    annualTotal: opts.annual ? round(monthly * 12) : null, discounts, notes,
  };
}
