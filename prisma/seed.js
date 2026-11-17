// Demo seed: a platform admin plus two sample organizations, so tenant
// isolation can be shown live. Safe to re-run: existing orgs are skipped.
//
//   SEED_PASSWORD=...  password for every seeded account (default below)
//   SEED_PLATFORM_EMAIL=...  platform admin email (default admin@associationos.app)
import bcrypt from 'bcryptjs';
import slugify from 'slugify';
import { prisma } from '../src/config/db.js';

const PASSWORD = process.env.SEED_PASSWORD || 'Demo@2026!';
const PLATFORM_EMAIL = (process.env.SEED_PLATFORM_EMAIL || 'admin@associationos.app').toLowerCase();

const daysFromNow = (n) => {
   const d = new Date();
   d.setUTCHours(0, 0, 0, 0);
   d.setUTCDate(d.getUTCDate() + n);
   return d;
};

const ORGS = [
   {
      name: 'Bayou City Business Chamber',
      slug: 'bayou-city-chamber',
      tagline: 'Connecting Houston businesses since 1987',
      primaryColor: '#0F5C8C',
      emailDomain: 'bayoucitychamber.org',
      phonePrefix: '713555',
      tiers: [
         { name: 'Small Business', price: 250, billing_cadence: 'Annual', benefits: ['Directory listing', 'Monthly mixers', 'Newsletter feature'] },
         { name: 'Corporate', price: 1200, billing_cadence: 'Annual', benefits: ['Everything in Small Business', 'Event sponsorship credit', 'Board luncheon seat'] },
         { name: 'Monthly Starter', price: 25, billing_cadence: 'Monthly', benefits: ['Directory listing', 'Member pricing on events'] },
      ],
      events: [
         { title: 'Monthly Networking Mixer', days: 6, start_time: '17:30', end_time: '19:30', location: 'Downtown Houston, Main St Hall', capacity: 120, price: 15 },
         { title: 'Small Business Lending Workshop', days: 13, start_time: '09:00', end_time: '11:00', location: 'Chamber Office, Suite 400', capacity: 40, price: 0 },
         { title: 'Annual Awards Gala', days: 34, start_time: '18:00', end_time: '22:00', location: 'Hilton Americas-Houston', capacity: 300, price: 125 },
         { title: 'Ribbon Cutting: Third Ward Bakery', days: -9, start_time: '10:00', end_time: '11:00', location: 'Third Ward', capacity: null, price: 0 },
      ],
      campaigns: [
         { name: 'Small Business Resilience Fund', goal: 50000, days: 60 },
         { name: 'Youth Entrepreneurship Scholarships', goal: 15000, days: 45 },
      ],
      people: [
         ['Monique Carter', 2], ['Daniel Okafor', 2], ['Priya Raman', 2], ['Marcus Bell', 2],
         ['Sofia Delgado', 2], ['James Whitfield', 2], ['Angela Nguyen', 3], ['Robert Hayes', 3], ['Tasha Greene', 3],
      ],
   },
   {
      name: 'Lone Star Professionals Association',
      slug: 'lone-star-pros',
      tagline: 'Professional development for Texas leaders',
      primaryColor: '#8C2F39',
      emailDomain: 'lonestarpros.org',
      phonePrefix: '512555',
      tiers: [
         { name: 'Professional', price: 180, billing_cadence: 'Annual', benefits: ['Workshops', 'Mentorship matching'] },
         { name: 'Student', price: 40, billing_cadence: 'Annual', benefits: ['Workshops', 'Career fair access'] },
      ],
      events: [
         // Same title as Org A on purpose: slugs are unique per organization.
         { title: 'Monthly Networking Mixer', days: 8, start_time: '18:00', end_time: '20:00', location: 'Austin, South Congress', capacity: 80, price: 10 },
         { title: 'Leadership Speaker Series', days: 20, start_time: '12:00', end_time: '13:30', location: 'Online', capacity: 500, price: 0 },
      ],
      campaigns: [{ name: 'Mentorship Program Fund', goal: 20000, days: 90 }],
      people: [
         ['Evelyn Brooks', 2], ['Hector Ramirez', 2], ['Grace Kim', 2], ['Tyrone Jackson', 3], ['Laura Chen', 3],
      ],
   },
];

async function ensurePlatformAdmin(hash) {
   const existing = await prisma.user.findUnique({ where: { email: PLATFORM_EMAIL } });
   if (existing) {
      if (!existing.isPlatformAdmin) {
         await prisma.user.update({ where: { id: existing.id }, data: { isPlatformAdmin: true } });
      }
      return console.log(`Platform admin exists: ${PLATFORM_EMAIL}`);
   }
   const org = await prisma.organization.upsert({
      where: { slug: 'associationos' },
      update: {},
      create: { name: 'AssociationOS', slug: 'associationos', tagline: 'Platform administration', primaryColor: '#1F3864' },
   });
   await prisma.user.create({
      data: {
         organizationId: org.id, name: 'Platform Admin', email: PLATFORM_EMAIL,
         phone: '0000000000', password: hash, role: 1, isPlatformAdmin: true,
      },
   });
   console.log(`Platform admin created: ${PLATFORM_EMAIL}`);
}

async function seedOrg(spec, hash) {
   if (await prisma.organization.findUnique({ where: { slug: spec.slug } })) {
      return console.log(`Skipping ${spec.name} (already exists)`);
   }

   await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
         data: { name: spec.name, slug: spec.slug, tagline: spec.tagline, primaryColor: spec.primaryColor },
      });
      const organizationId = org.id;

      const admin = await tx.user.create({
         data: {
            organizationId, name: 'Demo Admin', email: `admin@${spec.emailDomain}`,
            phone: `${spec.phonePrefix}0000`, password: hash, role: 1,
         },
      });

      const tiers = [];
      for (const t of spec.tiers) {
         tiers.push(await tx.membership.create({
            data: { organizationId, ...t, slug: slugify(t.name, { lower: true, strict: true }), auto_renewal: true, createdBy: admin.id },
         }));
      }

      const people = [];
      for (const [i, [name, role]] of spec.people.entries()) {
         const first = name.split(' ')[0].toLowerCase();
         const tier = role === 2 ? tiers[i % tiers.length] : null;
         const user = await tx.user.create({
            data: {
               organizationId, name, role,
               email: `${first}@${spec.emailDomain}`,
               phone: `${spec.phonePrefix}${String(i + 1).padStart(4, '0')}`,
               password: hash,
               membershipId: tier?.id ?? null,
            },
         });
         if (tier) {
            await tx.userMembershipHistory.create({
               data: {
                  organizationId, userId: user.id, membershipId: tier.id,
                  startDate: daysFromNow(-60 - i * 7),
                  endDate: tier.billing_cadence === 'Monthly' ? daysFromNow(30 - i) : daysFromNow(305 - i * 7),
               },
            });
         }
         people.push(user);
      }

      const members = people.filter((p) => p.role === 2);
      for (const [i, e] of spec.events.entries()) {
         const event = await tx.event.create({
            data: {
               organizationId, title: e.title, slug: slugify(e.title, { lower: true, strict: true }),
               date: daysFromNow(e.days), start_time: e.start_time, end_time: e.end_time,
               location: e.location, capacity: e.capacity, price: e.price,
               description: `${e.title} hosted by ${spec.name}.`,
               isRSVP: true, isPublic: i % 2 === 0, createdBy: admin.id,
            },
         });
         // A few RSVPs per event
         for (const m of members.slice(0, Math.max(1, members.length - i))) {
            await tx.rsvp.create({ data: { organizationId, user_id: m.id, event_id: event.id } });
         }
      }

      for (const c of spec.campaigns) {
         await tx.campaign.create({
            data: {
               organizationId, name: c.name, slug: slugify(c.name, { lower: true, strict: true }),
               goal: c.goal, date: daysFromNow(c.days), donation_amount: [25, 50, 100, 250],
               capacity: 0, description: `Support the ${c.name}.`,
               isCustomAmount: true, isPublic: true, isAnonymous: false, isEmailNotifiy: true,
               isRecurring: false, thank_you: `Thank you for supporting ${spec.name}!`,
            },
         });
      }
   }, { timeout: 30000 });

   console.log(`Seeded ${spec.name}: admin@${spec.emailDomain}`);
}

async function main() {
   const hash = await bcrypt.hash(PASSWORD, 10);
   await ensurePlatformAdmin(hash);
   for (const spec of ORGS) await seedOrg(spec, hash);
   // Never print a custom password: build logs are shared and secret-scanned.
   console.log(process.env.SEED_PASSWORD
      ? '\nAll seeded accounts use the password in SEED_PASSWORD.'
      : `\nAll seeded accounts use the default demo password (${PASSWORD}). Set SEED_PASSWORD for anything public.`);
}

main()
   .catch((err) => {
      console.error(err);
      process.exitCode = 1;
   })
   .finally(() => prisma.$disconnect());
