# Lecture Transcript (with timestamps)

17:03 The next thing is how to estimate the complexity of the model.

17:07 In general, it is difficult to compare complexity between different models.

17:13 For example, it's hard to tell whether a tree model is more complex or not compared to a neural network.

17:21 So on the other hand, given an algorithm family like neural network, it is possible to compare the model complexity in two ways.

17:30 The first way is you can compare the number of parameters. So how many weight parameters do you have in this model?

17:38 For example, if you compare a single linear regression model with a multilayer perceptron, your multilayer perceptron definitely has more parameters. So we say that multilayer perceptron is a more complex model.

17:52 The other consideration is the values taken by each parameter. So maybe my model could have a lot of parameters. However, maybe many of the parameters share the same value.

18:09 For example, in some models, there are a lot of zeros. If you have a lot of zeros, then your model is actually simpler than a model that has all different numbers.

18:22 Next class, we'll talk about convolutional neural networks. In that model, there are a lot of weight parameters that share the same value. Because they share the same value, you don't need too many numbers to describe the model. So those types of models are actually simpler compared to a fully connected multilayer perceptron.

18:51 This is about how we compare model complexity. This should give you a sense of whether you should increase or decrease complexity. Increase complexity means increase the number of layers or hidden units. Decrease complexity is the reverse.

19:13 And if you want to make an evaluation of data complexity, there are many factors. For example, the number of data points definitely matters for the complexity.
