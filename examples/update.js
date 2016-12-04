var ThinkTransaction = require('../thinkTransaction');
var transOptions = {
  timeout: 30 //timeout the transaction if it couldnt complete within this time window
};

//Update User John's lastName into Profile Collection
ThinkTransaction.begin(transOptions)
.then(function(trans) {
  trans.op.update({
    Profile : { //Profile is name of your collection in rethinkdb database
      set :{lastName:  "Kennedy"}, //By design, You could set any property of the document, including properties with deep structures.
                  //But, for now we have tested it only with simple flat properties
      where : {id: "7307a001-5051-41be-857d-fbe64a98cb5c", type : "User"} //This could be any js object you may pass to rethinkdb
                  // .filter() command. However, this library expects id (primary key on Profile collection) to be part of the filter.
                  // This limitation is to make determinstic selection on what you are trying to update, as other properties are bound to change
                  // from updates from other concurrent transactions
    }
  })
  .then(function(results){
    console.log('update commit handler');
    trans.commit().then(function(result){
      console.log('commit complete');
      console.log(result);
    })
  })
  .catch(function(err){
    console.log('update catch handler');
    console.log(err);
    trans.rollback().then(function(result){
      console.log('rollback complete');
      console.log(result);
    });
  });
});
