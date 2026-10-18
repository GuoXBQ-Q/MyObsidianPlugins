const {createTaskService}=require('./tasks');
const {createIdeaService}=require('./ideas');
const {createActivityService}=require('./activity');
const {createQuoteService}=require('./quotes');
function createServices(io,bus,integrations,events){return {io,bus,integrations,tasks:createTaskService(io,integrations),events,ideas:createIdeaService(io),quotes:createQuoteService(io),activity:createActivityService(io,bus)};}
module.exports={createServices};
