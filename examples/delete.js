var ThinkTransaction = require('../thinkTransaction');
var transOptions = {
  timeout: 30 //timeout the transaction if it couldnt complete within this time window
};

//Delete User John from Profile Collection
ThinkTransaction.begin(transOptions)
.then(function(trans) {
  trans.op.delete({
    Profile : {
      where : {firstName : "John", lastName:  "Kennedy", type : "User"} //This could be any js object you may pass to rethinkdb
                  // .filter() command. However, this library expects id (primary key on Profile collection) to be part of the filter.
                  // This limitation is to make determinstic selection on what you are trying to delete, as other properties are bound to change
                  // from updates from other concurrent transactions
    }
  })
  .then(function(results){
    console.log('delete commit handler');
    trans.commit().then(function(result){
      console.log('commit complete');
      console.log(result);
    })
  })
  .catch(function(err){
    console.log('delete catch handler');
    console.log(err);
    trans.rollback().then(function(result){
      console.log('rollback complete');
      console.log(result);
    });
  });
});
