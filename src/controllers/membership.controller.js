import slugify from 'slugify';

function tierData(body) {
   const name = typeof body.name === 'string' ? body.name.trim() : '';
   if (!name) return { error: 'Name is required' };
   const benefits = Array.isArray(body.benefits)
      ? body.benefits.map(String).map((b) => b.trim()).filter(Boolean)
      : [];
   return {
      data: {
         name,
         slug: slugify(name, { lower: true, strict: true }),
         price: body.price ? Number(body.price) : null,
         billing_cadence: body.billing_cadence != null ? String(body.billing_cadence) : null,
         benefits,
         auto_renewal: Boolean(body.auto_renewal),
      },
   };
}

export const getMemberships = async (req, res) => {
   const memberships = await req.db.membership.findMany({
      orderBy: { id: 'desc' },
      include: { _count: { select: { users: true } } },
   });
   res.json(memberships);
};

export const createMembership = async (req, res) => {
   const { data, error } = tierData(req.body);
   if (error) return res.status(400).json({ message: error });

   const existing = await req.db.membership.findFirst({ where: { slug: data.slug }, select: { id: true } });
   if (existing) return res.status(400).json({ message: 'Membership with this title already exists' });

   const tier = await req.db.membership.create({ data: { ...data, createdBy: req.user.id } });
   res.status(201).json(tier);
};

export const updateMembership = async (req, res) => {
   const id = Number(req.params.id);
   if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });

   const { data, error } = tierData(req.body);
   if (error) return res.status(400).json({ message: error });

   const existing = await req.db.membership.findFirst({ where: { slug: data.slug }, select: { id: true } });
   if (existing && existing.id !== id) {
      return res.status(400).json({ message: 'Membership with this title already exists' });
   }

   const tier = await req.db.membership.update({ where: { id }, data });
   res.status(200).json(tier);
};
