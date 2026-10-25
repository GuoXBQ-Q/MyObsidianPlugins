const builtins=[
  require('./banner'),require('./countdown'),require('./tasks'),require('./capture'),require('./ideas'),
  require('./shortcuts'),require('./summary'),require('./command'),require('./heatmap')
];
function registerBuiltins(registry){for(const definition of builtins)registry.register(definition);}
module.exports={registerBuiltins};
