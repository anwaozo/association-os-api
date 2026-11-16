// Public shapes for API responses. Never return User rows without one of these:
// the User table holds password hashes.
export const userPublic = {
   id: true,
   name: true,
   email: true,
   phone: true,
   role: true,
   status: true,
   membershipId: true,
   organizationId: true,
   createdAt: true,
};

// What members may see about each other (directory).
export const userDirectory = {
   id: true,
   name: true,
   email: true,
   phone: true,
   role: true,
   createdAt: true,
   membership: { select: { id: true, name: true } },
};

export const userMini = { id: true, name: true, email: true };

export const orgPublic = {
   id: true,
   name: true,
   slug: true,
   tagline: true,
   logoUrl: true,
   primaryColor: true,
};
