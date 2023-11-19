---
published: true
title: "🤖 GhidrOllama: Using Offline LLMs For Efficient Reverse-Engineering"
toc: true
toc_sticky: true
categories:
  - VR
tags:
  - Tooling
  - AI
  - Reverse Engineering
  - Ghidra Scripting
tagline: "In the last year, ChatGPT has created a huge surge in engineering effort going into large language models (LLMs). Now that a year has passed since the ChatGPT hype, more and more alternative open-source models are appearing thanks to a huge community of AI enthusiasts. Can these models be used for improving the efficiency of reverse engineers?"
excerpt: "LLMs have exploded in popularity recently, but how good are they at reverse-engineering?"
header:
  teaser: /assets/images/analysing_a_dirt_cheap_router/mcu.jpg
  overlay_image: /assets/images/analysing_a_dirt_cheap_router/mcu.jpg
  overlay_filter: 0.4
  #caption: "Photo credit: [**Unsplash**](https://unsplash.com)"
---

# What is an LLM?

LLM stands for large language model, and it is essentially a machine learning model that is trained on an absolutely massive set of text-based training data. As it is trained on the data, it captures the semantics of language so it can form sentences, it also learns how to code, as well as the syntax of common programming languages. It also remembers facts that are in the training data and it becomes exceptional at information recall. 

The model learns by adjusting 'parameters' or 'weights' to specific values as more and more data is fed-in, think of it like the strength of the connection between two neurons in your brain - this is how the model learns at a high level.

Once trained, the model acts as an active encoding of the initial data, allowing it to process queries by triggering relevant computational processes and generating appropriate responses. These models are notably large due to the extensive information incorporated during the training process, and their performance improves with the quantity and quality of the data they have been trained on.

# How do they work?

LLMs are essentially just massive neural networks. For a complex model like this, the neural networks need to be absolutely gigantic, I'm talking billions of parameters that take up huge amounts of storage. Fundamentally, neural networks are a pretty simple concept, and even the small ones can do some interesting things.

![camera.png](/assets/images/llms_for_reverse_engineering/neuron_activation.gif)

## Neural Network Example

As an example (and definitely not an excuse to plug one of my favourite projects), here is an old Processing sketch I made that basically teaches a car to drive around a track. It doesn't use conventional machine learning training (backpropagation/gradient descent), but it uses genetic algorithms, which is a whole different area of AI. 

For a little bit of context I'll explain how the cars learn. The genetic algorithm trains the parameters of the neural network to achieve the highest 'fitness score', which in this case is **speed * survival time**. Over generations, the models that get a bad score are 'culled', and the best models are mutated into other models with slightly altered parameters in an effort to get a better score. Not all of these changes will be beneficial, but some of the changes will result in better brains. After many iterations, the neural network will be trained to get a high score, and hopefully drive around the track. It is inspired by evolution!

![camera.png](/assets/images/llms_for_reverse_engineering/evolution.png)

The brain needs sensors to collect stimuli to process, in this case imagine that it has eyes, so it can see the distance to the edge of the track in a few directions. The brain also needs actuators to affect its environment, in this case it is turning left, turning right, accelerating, decelerating or doing nothing. These allow the brain to control the car, and understand its environment.

A couple of extra bits to explain, the laser is there to eliminate cars that go the wrong direction, as a car going the wrong direction would get the same fitness score as a car going in the right direction, so this keeps things in order. 

There is also the concept of bias in machine learning - each node in the network has a bias. The main function of a bias is to provide every node with a trainable constant value (in addition to the normal inputs that the node receives). Without the bias, a poorer fit may be achieved by the model. [This video provides a much better explanation](https://www.youtube.com/watch?v=HetFihsXSys).

Here are some of the best cars after several generations of training:

![camera.png](/assets/images/llms_for_reverse_engineering/driving.gif)

And here is the brain of the best car:

![camera.png](/assets/images/llms_for_reverse_engineering/brain.gif)

We can see the colour of the input neurons changing (on the left), signifying that it is getting closer/further away from the walls in the associated direction. We can also see one of the output neurons lighting up (on the right), signifying the action it took in that run of the network based on the inputs. The strength of the connections between the perceptrons is also signified by width and colour, green is a stronger connection (weight). 

The order of outputs on the right is as follows:
- Turn left
- Turn right
- Accelerate
- Decelerate
- Do nothing

As you can see, it is far more focused on turning left, right and accelerating, as it wants to go as fast as possible (to try and maximise the fitness metric by outrunning the laser!). It is essentially treating accelerate as 'do nothing' because it doesn't know its current speed (only the directions are fed into the network), and it doesn't need to slow down as it can still make the corners at max speed - so the output layer could be 3 nodes rather than 5. It is pretty fun making little neural networks and figuring out why they come up with their solution.

So, thats how a small neural network works, training of the neural network with backpropagation is a whole other complicated endeavour, so I won't be going into it in this blog! For the curious, [this blog](https://towardsdatascience.com/understanding-backpropagation-abcc509ca9d0) gives a simple example with a step-by-step explanation (pretty math-heavy, you've been warned!).

## Is that all an LLM is?

There's a lot more to LLMs than simple making the above network bigger. For example, one of the the big breakthroughs that resulted in these big LLMs is the 'transformer' architecture. This architecture essentially enables the model to process sequences, allowing it to understand and capture intricate relationships, even in lengthy data sequences. This architecture is the key to LLM's proficiency in generating text that closely resembles human-written content. If you want to learn about the details, the [paper is here](https://arxiv.org/pdf/1706.03762.pdf). For an lighter read, [this blog does a great job explaining transformers](https://rpradeepmenon.medium.com/introduction-to-large-language-models-and-the-transformer-architecture-534408ed7e61).

![camera.png](/assets/images/llms_for_reverse_engineering/transformer.png)

Also, the neural networks in LLMs are huge compared to the one we discussed earlier. Imagine cranking up that network to billions of parameters, adding 100 layers, and then training it on a massive chunk of the text-based data on the internet (which is gonna need a whole lot of computational power).

There is plenty of other stuff that makes LLMs work so well. The attention mechanism, the embeddings, the optimization algorithms, the safety filters (which is usually another neural network), etc. I guess what I am trying to say is that making huge models like this isn't simple, throwing more parameters into a simple neural network isn't going to result in an LLM. The network structure, training data, and fine tuning, all come into play to create something effective.

# LLM Examples

Obviously the main example of an LLM is ChatGPT, so we'll start there, but there is a huge amount of work in the open source community to create open-source models that are comparable to ChatGPT.

## ChatGPT

ChatGPT was released on November 2022, and after GPT-3 bought a lot of hype to the LLM world. It performed amazingly, and the amount of people playing with ChatGPT and using it for various tasks grew very large very quickly. The main benefit of the model was how accessible it was, you could just log on to OpenAI, and start chatting - I still remember how unbelievably impressed I was when I first used it, it blew my mind!

It is based on GPT-3.5, but also has support for GPT-4. The model itself (GPT-3.5) has 175 billion parameters, and 96 attention layers. It was trained on roughly 570GB of text-based data, which sounds like it is less than it actually is - it is actually about 8 million web pages worth of information. 

![camera.png](/assets/images/llms_for_reverse_engineering/chatgpt.png)

## Llama-2

Llama-2 is a model created by Meta, it was released on July 2023, and the thing that distinguishes it the most from ChatGPT is that is is an open model. It is free for research and commercial use, meaning that pretty much anyone can download the model and start using it. 

The release of this model was probably the second biggest AI 'event' in the last year, and as the model is open sourced, people can always retrain the model on different data sets and create variations that are fine tuned for various purposes, such as writing code or having a specific personality.

![camera.png](/assets/images/llms_for_reverse_engineering/llama2.png)

# Ollama

This tool basically acts as a bridge between user and mode. It has a couple of ways you can talk to the mode, either via an API, or just by talking to it on the command line. The installation is a really simple one-liner:

```
curl https://ollama.ai/install.sh | sh
```

You can then install one of the models listed [here](ollama.ai/library) and start talking to it like so:

```
ollama run codellama:7b
```

There are a bunch of models available for download (not just ***codellama***). However, it is worth remembering that these models are very CPU/GPU intensive, and also RAM hungry. Some of the much larger models required up to 200GB of RAM! If you are limited to 32GB of RAM, you should stick to a maximum of 40B parameters, but remember that the more parameters there are, the slower the model usually is.

I've found ***code-phind*** to be good for coding stuff, and ***falcon:40b*** to be good for general use. But feel free to download all of the models and have a play!

# Adding Ollama to Ghidra

So we have an understanding of what an LLM is, roughly how they work, and thanks to Ollama, we now have a way of talking to one! Now we can think about how we could possibly utilise one of these models for reverse-engineering .

## Uses in Reverse Engineering

Reverse engineering binaries with stripped symbols is a pretty complicated exercise. You are looking at code you have never seen before, with pretty much 0 hints as to how it works (minus debug strings most of the time). It can be twice as frustrating if you need to browse the assembly of an unfamiliar architecture, meaning you need to go and learn that as well...

What if we could offload some of the tedious work onto the LLM? That would make life much easier, and we could focus on the more complicated elements. Some of these options were inspired by other Ghidra ChatGPT plugins.

Here are some potential uses I came up with:
- Explain the current function
- Suggest a suitable name for the current function
- Suggest function comments
- Rewrite function to be descriptive
- Ask questions about current function
- Try and find bugs in current function
- Locate + identify leafblower functions
- Explain selected instruction
- Explain selected assembly
- Enter general prompt

Will the LLM be any good at these tasks? The only way to find out is to try it!

## Talking to the Ollama API

Ollama works by running a docker container which hosts the model, and also the API to interact with the model from other applications. Ghidra has a scripting interface than can be used to automate repetitive tasks/perform other useful functionality, it uses Python 2 and supports pretty much everything Python 2 has to offer. Therefore we can use this to talk to Ollama! The Ghidra scripting API is pretty annoying to write scripts with as all of the documentation is in Java, but it works well enough if you just assume its Python and hope for the best.

I won't go over the specifics of the script here, but here is what it does/how it works:
- Sends a message to the Ollama API to see the list of available models
- Spawns a window with a drop-down list allowing user to select the model
- Once model is selected, opens another window asking the user what they want to use the model for
- Once this is selected, any additional functionality-specific information is requested
- Now that the script knows what the user wants to do, it sends the request to the API and awaits the response
- By default, the Ollama API responds with a stream of data, so we can print each word as we receive it
- Once the 'done' parameter is set to true, we know the response has finished, so the script prints the total response time and exits

The script is [on github](https://github.com/luke-r-m/GhidrOllama), feel free to have a look or download and use it!

## Advantages

1. Completely offline, so no data sent to OpenAI
2. Could be hosted on a server on a local network/cloud
3. Loads of models available, results will improve as better models released
4. Specialised models could be constructed specifically for reverse engineering or Ghidra scripting via Fine-Tuning the open source model
5. You can train your own models on whatever data you want as they are not closed
6. Can get models without the annoying filters that stop them from talking about vulnerability research/exploitation 

## Disadvantages

1. Need very powerful/expensive hardware to run the models (GPU with plenty of VRAM)
2. Models can be slow when running locally
3. Not as performant as ChatGPT in some cases

# Testing

Lets see how it performs!

## Function Explanation

For this example, I made the model explain a decompiled form of ***strcasecmp*** with no symbols:

> *This function takes two byte pointers as input, 'param_1' and 'param_2', and returns their difference in terms of the ASCII value. It compares the characters at each position in the strings, accounting for case differences (e.g., uppercase letters are considered equal to their lowercase counterparts). The function stops comparing characters once it finds a character that is different between the two strings. If both strings are the same, the function returns 0.*

That is a [perfect explanation](https://www.ibm.com/docs/en/i/7.2?topic=functions-strcasecmp-compare-strings-without-case-sensitivity) of what ***strcasecmp*** does, it even figured out that letters of different cases will still match up.

## Function Naming

For this testing, I've taken a few standard C functions from some compiled source code, and run the freshly decompiled Ghidra output through the ***codellama:7b*** model 5 times to see if it can identify the name of the function/how close it gets. Here are the results:

| memmove | strncpy | strcasecmp | 
|-|-|-|-|
| memcpy_offset | strncpy | compare_strings | 
| memcpy | strncpy | compare_strings | 
| memmove | string_manipulate | strcmp | 
| memcpy | strncpy_s | compare_strings | 
| memmove | myStrncpy | compare_strings | 

Decent results for the first 3, lets try 3 more:

| strchr | strlen | memcpy |
|-|-|-|-|
| find_matching_element | strlen | memcpy |
| find_substring | stringLength | memcpy_optimized |
| find_character | stringLength | CopyMemoryBlock |
| matching_element | get_string_length | memcpy_aligned |
| strchr | strlen | memcpy_optimized |

Overall, it does do a pretty good job. The functions it is looking at have zero indication as to what the function does. All of the understanding is derived from seeing how the function manipulates its arguments, this is a very impressive result in my opinion! I found that if it included an explanation, it would perfectly explain what the function is doing, but it struggled to associate that functionality with the standard function name.

## Comments

Another useful application of LLMs is for writing comments, lets see how it performs on a decompiled ***strcpy***:

>*Here's the rewritten function with code comments added:*

>```
>-c
>uint *FUN_801a7070(uint *param_1, uint *param_2) {
>    // Local variables
>    char cVar1;
>    uint uVar2;
>    uint uVar3;
>    uint *puVar4;
>    uint uVar5;
>    int iVar6;
>
>    // Initialize local variables
>    uVar2 = DAT_801f0710;
>    iVar6 = DAT_801f0708;
>    puVar4 = param_1;
>
>    // Check if the input parameters are not null and have a length that is not multiple of 4
>    if ((((uint)param_2 | (uint)param_1) & 3) != 0) {
>        do {
>            // Read character from the input string
>            cVar1 = *(char *)param_2;
>
>            // Increment the pointer to the next character in the input string
>            param_2 = (uint *)((int)param_2 + 1);
>
>            // Write the read character to the output buffer
>            *(char *)puVar4 = cVar1;
>
>            // Increment the pointer to the next character in the output buffer
>            puVar4 = (uint *)((int)puVar4 + 1);
>        } while (cVar1 != '\0');
>
>        return param_1;
>    }
>
>    // Read the first uint from the input string and store it in uVar5
>    uVar5 = *param_2;
>
>    // Calculate a mask that is used to determine if the read uint matches the search pattern
>    uVar3 = ~uVar5 & uVar5 - DAT_801f0708 & DAT_801f0710;
>
>    // Loop until the mask indicates that a match has been found
>    while (uVar3 == 0) {
>        *puVar4 = uVar5;
>        param_2 = param_2 + 1;
>        uVar5 = *param_2;
>        puVar4 = puVar4 + 1;
>        uVar3 = uVar2 & ~uVar5 & uVar5 - iVar6;
>    }
>
>    // Initialize the index variable to 0
>    iVar6 = 0;
>
>    // Loop until the end of the input string is reached
>    do {
>        // Read a character from the input string at the current index
>        cVar1 = *(char *)((int)param_2 + iVar6);
>
>        // Write the read character to the output buffer at the current index
>        *(char *)((int)puVar4 + iVar6) = cVar1;
>
>        // Increment the index variable by 1
>        iVar6 = iVar6 + 1;
>    } while (cVar1 != '\0');
>
>    return param_1;
>}
>```

Those comments seem well placed, and representative of what is going on in the function at the point they are placed, looks good to me!

## Finding Bugs

I navigated to a function that I found a stack-based buffer overflow in on the Aliexpress router project, and wanted to test what bugs in the function the LLM suggests:

>*This function is vulnerable to several types of attacks, including:*

>* ***Buffer overflow***: *The function uses a fixed-size buffer (auStack_80) to store data, which can lead to a buffer overflow if the input data is longer than 104 characters. This can allow an attacker to write beyond the end of the buffer and corrupt the return address on the stack, leading to arbitrary code execution.*
>* ***Off-by-one error***: *The function uses a loop that iterates until the return value from FUN_800089e4 is -1. However, if the input data is longer than 103 characters, the loop will iterate one extra time, causing an off-by-one error and potentially leading to memory corruption or other security vulnerabilities.*
>* ***Use of uninitialized variables***: *The function uses several variables (iVar3, iVar4, iVar5) without initializing them before use. If these variables are not properly initialized, they may contain garbage values that can lead to unexpected behavior, including memory corruption or security vulnerabilities.*
>* ***Use of hardcoded constants***: *The function contains several hardcoded constants (0x14, 0x5010201) that could be modified by an attacker to control the program's behavior.*
>* ***Insecure use of FUN_80013734***: *The function uses FUN_80013734 with a parameter that is not properly validated, which can lead to memory corruption or other security vulnerabilities if the input data is invalid.*

You can see it spots the possible overflow straight away, it is important to note that it doesn't have the context that config values can be up to 256 bytes. Therefore it is unable to confirm if this is definitely a bug, this is merely a suggestion.

Some of the other outputs are pretty questionable. For example, the hardcoded constants, I'm not entirely sure how that means that they can be modified by an attacker if they are hardcoded? The use of uninitialised variables is also a side-effect of the stack frame missing structs/having incorrect types, so probably not a bug in the decompiler output. 

Overall, for a pretty small model, it does a decent job of coming up with suggestions for things to look at within a function, but more context is definitely required to take this further.

## Explaining Instructions

Aside from analysing functions, how good is it at acting as a dictionary for assembly instructions? Here is an example on the ***bne v0,zero,LAB_8016eed4*** instruction:

> *The instruction* ***bne*** *in MIPS is a branch instruction that branches to address 0x8016eed4 if register v0 is not equal to zero.*

> *Here is the instruction format for the* ***bne*** *instruction*:
> ```
> bne rt, rs, offset
> ```
> * ***rt***: *Register that holds the value to be compared.*
> * ***rs***: *Register that holds the value to be compared with.*
> * ***offset***: *Offset to be added to the current program counter (PC) and used as the target address for the branch.*

> *In this case, the instruction is* ***bne v0, zero, 0x8016eed4***. *It branches to address 0x8016eed4 if register v0 is not equal to zero.*

This is a straight to the point explanation of what the instruction does, the format, and ends by applying the explanation to the provided line of assembly.

## Explaining Assembly

So it can explain instructions, but what about small chunks of assembly code? Lets try it with the following:

```
-mipsasm
jal FUN_801a6f4c
_move a0, s2
bne v0,zero,LAB_8016eed4
_lui a1, 0x801f
```

Here is the output of the model:

> *This MIPS assembly code is calling the function at address 0x801a6f4c and passing two registers as arguments. The first argument (a0) is being loaded from register s2, while the second argument (a1) is being set to a constant value of 0x801f using the _lui instruction.*

> *The code then checks if the return value (v0) is zero and jumps to address 0x8016eed4 if it is not. If v0 is zero, the code continues executing past this point.*

From the output, it seems to have taken its understanding of the individual instructions, inferred the full purpose of the block of instructions, and provided a clear explanation.

# Conclusion

To be honest, I was very surprised at how effective the worst *codellama* model was at understanding the code. I was under the impression it would be fine-tuned to be amazing at code generation, not code understanding. However, I learned that *codellama* has a feature called *infilling* turned on, which means it can complete code/fill in gaps in code. Obviously some understanding of existing code is required to perform this effectively, which I believe is making it unintentionally quite good at reverse engineering!

I have been using this script in my day-to-day Ghidra-ing and honestly I've found it quite useful for offloading tedious tasks, or saving me a Google search. You can also bind it to the 'Q' key for very easy access. [Give it a try](https://github.com/luke-r-m/GhidrOllama), and let me know what you think!

![camera.png](/assets/images/llms_for_reverse_engineering/ghidrollama.png)