import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
   const hashedPassword = await bcrypt.hash("admin@2025", 10);

   const exists = await prisma.user.findUnique({
      where: { email: "admin@mail.com" }
   });

   if (!exists) {
      await prisma.user.create({
         data: {
            name: "Super Admin",
            email: "admin@mail.com",
            password: hashedPassword,
            role: 1
         }
      });
      console.log("Admin user created!");
   } else {
      console.log("Admin already exists.");
   }
}

main()
  .catch(err => console.log(err))
  .finally(() => prisma.$disconnect());
