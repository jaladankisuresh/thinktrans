var uuid = require('uuid');
var ThinkTransaction = require('../thinkTransaction');
var transOptions = {
  timeout: 30 //timeout the transaction if it couldnt complete within this time window
};

//Insert New User into Profile Collection
ThinkTransaction.begin(transOptions)
.then(function(trans) {
  trans.op.insert({
    Profile : { // Profile is name of your collection in rethinkdb database
      id : uuid.v4(), //REQUIRED : You will need to explicity pass id value along with other attributes of the document
      type: "User",
      firstName : "John",
      lastName : "K"
    }
  })
  .then(function(results){
    console.log('insert commit handler');
    trans.commit().then(function(result){
      console.log('commit complete');
      console.log(result);
    })
  })
  .catch(function(err){
    console.log('insert catch handler');
    console.log(err);
    trans.rollback().then(function(result){
      console.log('rollback complete');
      console.log(result);
    });
  });
});
