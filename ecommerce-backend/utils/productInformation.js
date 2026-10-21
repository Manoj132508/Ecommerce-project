const includesAny = (value, terms) => terms.some((term) => value.includes(term));

const titleCase = (value) => value.replace(/\b\w/g, (letter) => letter.toUpperCase());

const guides = {
  default: {
    description: "This product is designed for straightforward everyday use and offers a practical way to meet the needs suggested by its name and category. Its simple design makes it easy to include in your usual routine at home or while travelling.",
    howItWorks: "Choose the quantity you need, add it to your cart, and use the product for its intended purpose after delivery. Check the product and any included instructions before first use so that it can be used safely and effectively.",
    careInstructions: "Keep the product clean and dry when it is not being used. Follow any care instructions supplied with the item, avoid unsuitable conditions, and inspect it regularly so it remains in good condition."
  },
  appliance: {
    description: "This kitchen appliance is intended to make a common food or drink preparation task quicker and more convenient. Its countertop-friendly design supports regular home use while helping reduce the effort required for manual preparation.",
    howItWorks: "Place the appliance on a stable, dry surface, add the appropriate ingredients or water, and use its controls to begin the preparation process. Always stay within the recommended capacity and switch the appliance off before opening, pouring, or cleaning it.",
    careInstructions: "Disconnect the appliance and allow it to cool before cleaning. Keep electrical parts away from water, clean removable food-contact parts after use, and refer to the supplied instructions for model-specific safety guidance."
  },
  cookware: {
    description: "This cookware is made for preparing everyday meals with a practical cooking surface and a shape suited to common kitchen tasks. It can help organise meal preparation whether you are cooking a quick portion or preparing food for several people.",
    howItWorks: "Place the cookware securely on a suitable hob, add the ingredients, and increase the heat gradually. Use utensils that will not damage the cooking surface, monitor the food while it cooks, and use the lid when appropriate to retain heat and moisture.",
    careInstructions: "Let the cookware cool before washing it with a soft sponge and suitable detergent. Avoid abrasive tools that may scratch the surface, dry each piece before storage, and follow any hob-compatibility instructions provided with the product."
  },
  dining: {
    description: "This dining and food-storage product is designed to keep serving, organising, or storing food simple. Its coordinated form makes it a useful addition to everyday meals, table settings, or kitchen organisation.",
    howItWorks: "Use each piece for food that suits its size and intended purpose. Arrange food evenly, secure any lid before storage or transport, and avoid sudden temperature changes unless the supplied product instructions confirm they are safe.",
    careInstructions: "Wash before first use and clean after contact with food. Handle each piece carefully, check whether it is dishwasher or microwave safe before using those appliances, and stack it securely to reduce the chance of chips or damage."
  },
  apparel: {
    description: "This clothing item is designed as a comfortable and versatile addition to an everyday wardrobe. Its style can be worn on its own or combined with other pieces to suit the weather, occasion, and your preferred look.",
    howItWorks: "Choose the appropriate size and wear the item in a way that allows comfortable movement. Layer or accessorise it as needed, and check the fit before extended use so seams, fastenings, and fabric sit comfortably.",
    careInstructions: "Read the garment label before washing because fabric care can vary. Wash with similar colours, use an appropriate cycle and temperature, and dry and store the item in a way that helps it retain its shape."
  },
  footwear: {
    description: "This footwear is designed to support everyday movement while completing a casual, smart, or active outfit. The shape and style provide a practical option for the activities suggested by the product name.",
    howItWorks: "Select the correct size, put on both shoes, and adjust any laces, straps, or fastenings until the fit feels secure without being restrictive. Try them on a clean surface first and increase wear time gradually if needed.",
    careInstructions: "Remove surface dirt with a soft cloth or brush and use cleaning products suitable for the shoe material. Allow footwear to air-dry away from direct heat and store it in a dry, ventilated place."
  },
  home: {
    description: "This home product is designed to improve the comfort, appearance, or organisation of a living space. It provides a practical finishing touch for the room suggested by its name while remaining easy to include in an existing setup.",
    howItWorks: "Position or install the item in the intended area, making sure it is stable, secure, and suitable for the available space. Adjust its placement until it performs its purpose effectively without blocking walkways, fixtures, or ventilation.",
    careInstructions: "Clean the product using a method suitable for its material and check any care label before washing. Keep it away from conditions that could cause unnecessary moisture, heat, fading, or physical damage."
  },
  accessory: {
    description: "This accessory is designed to add a useful or decorative finishing detail to an outfit. Its compact format makes it easy to wear, carry, and combine with different styles for everyday or occasional use.",
    howItWorks: "Put on or position the accessory carefully and check that any clasp, arm, post, or fastening is secure and comfortable. Remove it before activities where it could catch, bend, or become damaged.",
    careInstructions: "Wipe the accessory gently after use and store it separately in a clean, dry place. Avoid harsh chemicals, excessive moisture, and unnecessary pressure so its finish and shape are protected."
  },
  consumable: {
    description: "This household consumable is intended to make routine cleaning, drying, or personal-care tasks more convenient. The multipack format helps keep replacement items available for regular use around the home.",
    howItWorks: "Remove one item or the recommended amount from the pack and use it for the task stated on the product. For cleaning products, follow the package directions and test on a small area first when surface compatibility is uncertain.",
    careInstructions: "Keep unused items sealed in their original packaging and store them in a cool, dry place. Keep cleaning products away from children and pets, and follow all safety and disposal information shown on the package."
  }
};

function selectGuide(searchableProduct) {
  if (includesAny(searchableProduct, ["appliance", "blender", "kettle", "espresso maker"])) return guides.appliance;
  if (includesAny(searchableProduct, ["cookware", "cooking pot", "cook set", "cooking set"])) return guides.cookware;
  if (includesAny(searchableProduct, ["plate", "bowl", "food container"])) return guides.dining;
  if (includesAny(searchableProduct, ["shoe", "sneaker", "footwear", "sandal", "heel", "ballet flat"])) return guides.footwear;
  if (includesAny(searchableProduct, ["apparel", "shirt", "sweater", "dress", "shorts", "pants", "hat", "beanie"])) return guides.apparel;
  if (includesAny(searchableProduct, ["tissue", "paper towel", "detergent", "cleaning", "napkin"])) return guides.consumable;
  if (includesAny(searchableProduct, ["curtain", "duvet", "sheet", "bathmat", "bath mat", "towel", "mirror", "bedroom", "bathroom"])) return guides.home;
  if (includesAny(searchableProduct, ["jewelry", "earring", "sunglasses", "accessories", "shades"])) return guides.accessory;
  return guides.default;
}

export function getProductCategory(product) {
  const searchableProduct = [
    product.name,
    ...(product.keywords ?? [])
  ].filter(Boolean).join(" ").toLowerCase();

  if (includesAny(searchableProduct, ["appliance", "blender", "kettle", "espresso maker"])) {
    return "Kitchen Appliances";
  }

  if (includesAny(searchableProduct, ["shoe", "sneaker", "footwear", "sandal", "heel", "ballet flat"])) {
    return "Footwear";
  }

  if (includesAny(searchableProduct, ["apparel", "shirt", "sweater", "dress", "shorts", "pants", "hat", "beanie"])) {
    return "Clothing";
  }

  if (includesAny(searchableProduct, ["tissue", "paper towel", "detergent", "cleaning", "napkin"])) {
    return "Household Essentials";
  }

  if (includesAny(searchableProduct, ["curtain", "duvet", "sheet", "bathmat", "bath mat", "towel", "mirror", "bedroom", "bathroom"])) {
    return "Home & Bathroom";
  }

  if (includesAny(searchableProduct, ["jewelry", "earring", "sunglasses", "accessories", "shades"])) {
    return "Accessories";
  }

  if (includesAny(searchableProduct, ["kitchen", "cookware", "cooking", "plate", "bowl", "food container"])) {
    return "Kitchen & Dining";
  }

  return "General";
}

export function getProductInformation(product) {
  const labels = [product.category, ...(product.keywords ?? [])]
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  const highlights = [...new Set(labels)].slice(0, 4).map(titleCase);
  const normalizedHighlights = highlights.length > 0
    ? highlights
    : ["Everyday Use", "Simple to Use", "Practical Design"];
  const searchableProduct = [product.name, ...labels].join(" ").toLowerCase();
  const guide = selectGuide(searchableProduct);

  return {
    description: `${product.name} is part of our ${normalizedHighlights[0].toLowerCase()} selection. ${guide.description}`,
    howItWorks: guide.howItWorks,
    highlights: normalizedHighlights,
    careInstructions: guide.careInstructions
  };
}
