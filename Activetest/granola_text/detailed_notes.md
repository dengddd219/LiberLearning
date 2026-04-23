
- Custom workflow design capabilities
    - In the meeting, the concept of custom workflow design capabilities was discussed, highlighting the flexibility in creating tailored workflows. Deng Patrick explained, "You can draw your own workflow, basically," emphasizing the ability to connect different components using edges to define a custom-made workflow. This flexibility allows for the integration of various actions and components, such as functions and agents, to suit specific needs.
  - Conditional edges based on room availability
    - In the meeting, the concept of "conditional edges" was discussed in the context of designing a workflow for an agent framework. It was explained that the workflow is "conditional, in a sense that the demanding model availability the sense the reason we do this is because this workflow is you know, it's straightforward, and you can actually pre design the the workflow." This means that the workflow can adapt based on certain conditions, such as room availability, allowing for actions like suggesting or booking a room for the user. The design aims to strictly control the process to avoid randomness and ensure a well-defined output.
  - Pre-designed workflows for strict control
    - In the meeting, it was discussed that the workflow design involves pre-designed workflows to maintain strict control. This approach is intentional to avoid randomness in the process. As mentioned, "we don't want rhythmics in this process. Because if it's then we should do something else." This indicates the importance of having a structured and controlled workflow to ensure predictable outcomes.
  - Flexible node connections using different edge types
    - In the meeting, it was discussed that the workflow design allows for flexibility in connecting nodes using different edge types. This flexibility is highlighted by the statement, "you decide the cloud to connect as there is each other, using different edge then you will be able to define a customer made workflow." This indicates that users can customize their workflows by selecting how nodes are interconnected, allowing for tailored and adaptable processes.
- Core components:
    - In the meeting, the core components of the Azure OpenAI agent framework were discussed. One of the components highlighted is the "workflow builder with conditional edge," which allows for the creation of custom workflows by connecting nodes and edges. As stated, "we are using a workflow builder to build a workflow ourselves." Additionally, the framework includes an "executor, which is agents," and nodes that may represent either agents or functions. The use of "identity models" was also mentioned, which helps define data structures for outputs, ensuring they are "not like a random style or random text."
  1. Workflow builder with conditional logic
     1. The concept of a "Workflow builder with conditional logic" was discussed in the meeting as a method for designing workflows with specific conditions. Deng Patrick explained, "Essentially, we are using a workflow builder to build a workflow ourselves." This allows for the creation of a structured and controlled process, where actions are determined by specific conditions, such as model availability. The approach is intended to avoid randomness and ensure that the workflow is straightforward and pre-designed, as Patrick noted, "We don't want rhythmics in this process."
  2. Executor agents as workflow nodes
     1. In the meeting, the concept of "Executor agents as workflow nodes" was discussed in the context of designing a workflow using the Azure OpenAI agent framework. Deng Patrick explained that within the workflow, "we have executor, which is agents," indicating that these agents function as nodes within the workflow. This setup allows for the execution of specific tasks or functions, as he mentioned, "you may sometimes use a function, sometimes you may use, like, widgets." This approach provides flexibility in designing custom workflows by integrating various components such as agents and functions.
  3. Function nodes (non-agent components)
     1. During the meeting, deng Patrick discussed the importance of having structured outputs in the workflow design. He mentioned using a package in Python to define data structures, stating, "Basically, it uses the pandemic model to find output structure." This approach ensures that outputs are consistent and not random, as he explained, "So that's our outputs is 12 to nine. It's not like a random style or random text." This emphasis on well-defined outputs helps maintain clarity and reliability in the workflow's results.
  4. Pydantic models for structured outputs
     1. In the meeting, it was discussed how Pydantic models are utilized to ensure a structured data format in the workflow design. Deng Patrick mentioned, "Basically, it uses the pandemic model to find output structure," highlighting that this approach ensures outputs are not in a random style or random text, but rather well-defined. This structured approach is beneficial for maintaining consistency and clarity in data outputs.
- Well-defined outputs (well-defined的输出)
    - In the meeting, the concept of well-defined outputs was discussed in relation to using the Pydantic model to define output structures. This approach ensures that outputs are structured and not "random style or random text," which is crucial for maintaining consistency and reliability in the workflow. This structure allows for outputs that are consistent and predictable, which is important when working with large language models and agent frameworks.
  -  structured data format
    - In the meeting, it was discussed that the framework utilizes Pydantic models to ensure a structured data format for outputs. This is highlighted by the statement, "Basically, it uses the pandemic model to find output structure," which ensures that outputs are well-defined and not random. This approach allows for consistency and clarity in the data being handled, which is particularly beneficial in projects requiring structured outputs.
  - Prevents random text generation from language models
    - In the meeting, it was discussed that using a structured output approach helps in preventing random text generation from language models. Deng Patrick mentioned, "Basically, it uses the pandemic model to find output structure. So that's our outputs is 12 to nine. It's not like a random style or random text." This approach ensures that the outputs are well-defined and consistent, which is crucial for maintaining control over the responses generated by the models.
  - Maintains consistency across different scenarios
    - In the meeting, it was discussed that the framework ensures "well-defined的输出" by using a structured approach to maintain consistency across different scenarios. This is achieved by using the Pydantic model to define output structures, which ensures that outputs are consistent and not random. As mentioned, "Basically, it uses the pandemic model to find output structure. So that's our outputs is 12 to nine. It's not like a random style or random text." This structured approach allows for predictable and reliable outputs in various scenarios.













