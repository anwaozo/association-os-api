import app from './src/app.js';
import { env } from './src/config/env.js';

app.listen(env.PORT, () => console.log(`AssociationOS API on http://localhost:${env.PORT}`));
