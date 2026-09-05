import { createApp } from './app.mjs';
const {app,db}=createApp();
const server=app.listen(Number(process.env.PORT||3202),'0.0.0.0',()=>console.log('Qifa Quiz ready'));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
