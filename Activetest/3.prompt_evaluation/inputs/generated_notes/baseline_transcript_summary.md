In general, it is difficult to compare complexity between different models. For example, it's hard to tell whether a tree model is more complex or not compared to a neural network.

Given an algorithm family like neural network, it is possible to compare the model complexity in two ways. The first way is to compare the number of parameters. For example, a multilayer perceptron has more parameters than a single linear regression model, so it is more complex. The other consideration is the values taken by each parameter. If many parameters share the same value or are zero, the model is actually simpler. In convolutional neural networks, many weight parameters share the same value, so they require fewer numbers to describe and are simpler than a fully connected multilayer perceptron.

Increasing complexity means increasing the number of layers or hidden units. Decreasing complexity is the reverse. The number of data points also matters for data complexity.
